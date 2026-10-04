import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { investigateIncident, normalizeKey } from "./investigator.js";
import { providerFor, type KeyProvider } from "./providers.js";
import type {
  FileOutcome,
  IncidentState,
  Investigation,
  ResponseResult,
  RotationOutcome,
} from "./types.js";

export interface ResponseOptions {
  workspaceRoot: string;
  database: DatabaseSync;
  sessionId: string;
  trigger: string;
  providers: readonly KeyProvider[];
  investigatorNarrative?: string;
  responderNarrative?: string;
}

export async function respondDeterministically(options: ResponseOptions): Promise<ResponseResult> {
  const investigation = investigateIncident(
    options.database,
    options.workspaceRoot,
    options.sessionId,
    options.trigger,
  );
  const state = loadOrCreateState(options.workspaceRoot, investigation);
  const rotations = await rotateExposedKeys(investigation, state, options.providers, options.workspaceRoot);
  const files = repairTaintedFiles(investigation, state, options.workspaceRoot);
  state.closed = canClose(rotations, files);
  state.updatedAt = new Date().toISOString();
  writeState(options.workspaceRoot, state);
  writeIncidentReport(options.workspaceRoot, investigation, state);
  return {
    investigation,
    rotations,
    files,
    reportPath: state.reportPath,
    closed: state.closed,
    ...(options.investigatorNarrative ? { investigatorNarrative: options.investigatorNarrative } : {}),
    ...(options.responderNarrative ? { responderNarrative: options.responderNarrative } : {}),
  };
}

export async function rotateExposedKeys(
  investigation: Investigation,
  state: IncidentState,
  providers: readonly KeyProvider[],
  workspaceRoot: string,
): Promise<RotationOutcome[]> {
  const outcomes: RotationOutcome[] = [];
  for (const keyName of investigation.exposedKeys) {
    const provider = providerFor(providers, keyName);
    if (!provider) {
      const outcome: RotationOutcome = {
        keyName,
        provider: "unsupported",
        status: "unsupported",
        oldRejected: false,
        message: `NO PROVIDER: ${keyName} was exposed but has no rotation provider.`,
      };
      state.rotations[keyName] = outcome;
      writeState(workspaceRoot, state);
      outcomes.push(outcome);
      continue;
    }

    const previous = state.rotations[keyName];
    if (previous?.receipt) {
      const rejected = await provider.verifyOldRejected(previous.receipt);
      const outcome: RotationOutcome = rejected ? {
        ...previous,
        status: "already-rotated",
        oldRejected: true,
        message: `${keyName} was already rotated; the old credential is rejected.`,
      } : {
        ...previous,
        status: "verification-failed",
        oldRejected: false,
        message: `CRITICAL: ${keyName} was rotated previously, but the old credential is STILL ALIVE.`,
      };
      state.rotations[keyName] = outcome;
      writeState(workspaceRoot, state);
      outcomes.push(outcome);
      continue;
    }

    const receipt = await provider.rotate(keyName);
    // Persist the non-secret receipt before verification so a crash cannot rotate twice.
    state.rotations[keyName] = {
      keyName,
      provider: provider.name,
      status: "rotated",
      oldRejected: false,
      receipt,
      message: `${keyName} rotated; verification pending.`,
    };
    writeState(workspaceRoot, state);

    const rejected = await provider.verifyOldRejected(receipt);
    const outcome: RotationOutcome = rejected ? {
      keyName,
      provider: provider.name,
      status: "rotated",
      oldRejected: true,
      receipt,
      message: `${keyName} rotated and the old credential is rejected.`,
    } : {
      keyName,
      provider: provider.name,
      status: "verification-failed",
      oldRejected: false,
      receipt,
      message: `CRITICAL: ${keyName} rotated, but the old credential is STILL ALIVE.`,
    };
    state.rotations[keyName] = outcome;
    writeState(workspaceRoot, state);
    outcomes.push(outcome);
  }
  return outcomes;
}

export function repairTaintedFiles(
  investigation: Investigation,
  state: IncidentState,
  workspaceRoot: string,
): FileOutcome[] {
  const outcomes: FileOutcome[] = [];
  for (const file of investigation.taintedFiles) {
    const previous = state.files[file.path];
    if (previous && previous.status !== "review") {
      const verified = verifyPreviousFileOutcome(previous, file, workspaceRoot, state.incidentId);
      outcomes.push(verified);
      if (verified.status === "review") state.files[file.path] = verified;
      continue;
    }

    const absolute = safeWorkspacePath(workspaceRoot, file.path);
    if (!absolute) {
      const outcome = review(file.path, "Path is outside the protected repository.");
      state.files[file.path] = outcome;
      outcomes.push(outcome);
      continue;
    }

    if (!existsSync(absolute)) {
      if (file.existedBefore) {
        const outcome = review(file.path, "Previously existing tainted file is missing; deletion may be a later edit.");
        state.files[file.path] = outcome;
        outcomes.push(outcome);
        continue;
      }
      const outcome: FileOutcome = {
        path: file.path,
        status: "already-resolved",
        message: "File is already absent.",
      };
      state.files[file.path] = outcome;
      outcomes.push(outcome);
      continue;
    }

    if (!file.expectedCurrentHash) {
      const outcome = review(file.path, "Warden cannot prove the current file still matches the attack write.");
      state.files[file.path] = outcome;
      outcomes.push(outcome);
      continue;
    }
    const currentHash = createHash("sha256").update(readFileSync(absolute)).digest("hex");
    if (currentHash !== file.expectedCurrentHash) {
      const outcome = review(file.path, "File changed after the attack; Warden left it untouched.");
      state.files[file.path] = outcome;
      outcomes.push(outcome);
      continue;
    }

    if (file.existedBefore) {
      const snapshot = safeSnapshotPath(workspaceRoot, file.snapshotPath);
      if (!snapshot) {
        const outcome = review(file.path, "Recovery snapshot is missing.");
        state.files[file.path] = outcome;
        outcomes.push(outcome);
        continue;
      }
      copyFileSync(snapshot, absolute);
      const repairedHash = hashPath(absolute);
      const outcome: FileOutcome = {
        path: file.path,
        status: "restored",
        repairedHash,
        message: "Restored the first pre-taint snapshot.",
      };
      state.files[file.path] = outcome;
      outcomes.push(outcome);
      continue;
    }

    const quarantineRoot = secureDirectory(workspaceRoot, path.join(".warden", "quarantine", safeName(state.incidentId)));
    const destination = safeQuarantinePath(quarantineRoot, file.path);
    secureDirectory(quarantineRoot, path.relative(quarantineRoot, path.dirname(destination)));
    if (existsSync(destination)) {
      const outcome = review(file.path, "Quarantine destination already exists; existing evidence was preserved.");
      state.files[file.path] = outcome;
      outcomes.push(outcome);
      continue;
    }
    renameSync(absolute, destination);
    const repairedHash = hashPath(destination);
    const outcome: FileOutcome = {
      path: file.path,
      status: "quarantined",
      destination: path.relative(workspaceRoot, destination).replaceAll("\\", "/"),
      repairedHash,
      message: "Moved attacker-created file to quarantine.",
    };
    state.files[file.path] = outcome;
    outcomes.push(outcome);
  }
  writeState(workspaceRoot, state);
  return outcomes;
}

export function writeIncidentReport(
  workspaceRoot: string,
  investigation: Investigation,
  state: IncidentState,
): string {
  const report = [
    `# Warden Incident ${state.incidentId}`,
    "",
    `**Status:** ${state.closed ? "CLOSED" : "OPEN — ACTION REQUIRED"}`,
    `**Trigger:** ${investigation.trigger}`,
    `**Affected session:** ${investigation.sessionId}`,
    `**Generated:** ${new Date().toISOString()}`,
    "",
    "## 30-second summary",
    "",
    summarySentence(investigation, state),
    "",
    "## Agent chain",
    "",
    ...agentChain(investigation),
    "",
    "## Real credential exposure",
    "",
    ...(investigation.exposedKeys.length
      ? investigation.exposedKeys.map((key) => `- ${key}: ${state.rotations[key]?.message ?? "not handled"}`)
      : ["- No real key grants were recorded for the affected session."]),
    "",
    "## File recovery",
    "",
    ...(Object.values(state.files).length
      ? Object.values(state.files).map((file) => `- ${file.path}: **${file.status}** — ${file.message}${file.destination ? ` (${file.destination})` : ""}`)
      : ["- No tainted files were linked to this chain."]),
    "",
    "## Needs review",
    "",
    ...reviewItems(state),
    "",
    "## Cline session roles",
    "",
    "- Investigator session: read-only ledger analysis and exposure attribution.",
    "- Responder session: invoked only bounded deterministic remediation tools.",
    "",
    "## Closure check",
    "",
    state.closed
      ? "All exposed supported keys were rotated, old credentials were rejected, and every tainted file was restored, quarantined, or already absent."
      : "Incident remains open. Resolve every CRITICAL rotation failure, unsupported exposed key, and file marked for review.",
    "",
  ].join("\n");
  const incidents = secureDirectory(workspaceRoot, path.join(".warden", "incidents"));
  const absolute = path.join(incidents, `incident_${safeName(state.incidentId)}.md`);
  state.reportPath = path.relative(workspaceRoot, absolute).replaceAll("\\", "/");
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, report, "utf8");
  return state.reportPath;
}

export function loadOrCreateState(workspaceRoot: string, investigation: Investigation): IncidentState {
  const filename = statePath(workspaceRoot, investigation.sessionId);
  if (existsSync(filename)) {
    try {
      const state = JSON.parse(readFileSync(filename, "utf8")) as IncidentState;
      if (validState(state, investigation.sessionId)) {
        state.trigger = investigation.trigger;
        state.reportPath = path.relative(workspaceRoot, safeIncidentReportPath(workspaceRoot, state.incidentId)).replaceAll("\\", "/");
        return state;
      }
    } catch {
      // Invalid responder state is ignored; deterministic evidence is rebuilt from the ledger.
    }
  }
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const incidentId = `${stamp}_${safeName(investigation.sessionId)}`;
  return {
    version: 1,
    incidentId,
    sessionId: investigation.sessionId,
    trigger: investigation.trigger,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    reportPath: `.warden/incidents/incident_${incidentId}.md`,
    rotations: {},
    files: {},
    closed: false,
  };
}

function writeState(workspaceRoot: string, state: IncidentState): void {
  const incidents = secureDirectory(workspaceRoot, path.join(".warden", "incidents"));
  const filename = path.join(incidents, `response_${safeName(state.sessionId)}.json`);
  state.updatedAt = new Date().toISOString();
  writeFileSync(filename, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function statePath(workspaceRoot: string, sessionId: string): string {
  const incidents = secureDirectory(workspaceRoot, path.join(".warden", "incidents"));
  return path.join(incidents, `response_${safeName(sessionId)}.json`);
}

function safeWorkspacePath(root: string, key: string): string | null {
  const realRoot = realpathSync(root);
  const absolute = path.resolve(realRoot, key);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  let parent = path.dirname(absolute);
  while (!existsSync(parent) && path.dirname(parent) !== parent) parent = path.dirname(parent);
  const realParent = realpathSync(parent);
  if (!inside(realRoot, realParent)) return null;
  if (existsSync(absolute)) {
    if (lstatSync(absolute).isSymbolicLink()) return null;
    const real = realpathSync(absolute);
    if (!inside(realRoot, real)) return null;
  }
  return absolute;
}

function safeQuarantinePath(root: string, key: string): string {
  const normalized = normalizeKey(key).split("/").filter((part) => part && part !== "..").join(path.sep);
  return path.join(root, normalized || "quarantined-file");
}

function safeSnapshotPath(workspaceRoot: string, snapshotPath: string | null): string | null {
  if (!snapshotPath || !existsSync(snapshotPath) || lstatSync(snapshotPath).isSymbolicLink()) return null;
  const snapshotsRoot = path.join(realpathSync(workspaceRoot), ".warden", "snapshots");
  if (!existsSync(snapshotsRoot)) return null;
  const real = realpathSync(snapshotPath);
  return inside(realpathSync(snapshotsRoot), real) && lstatSync(real).isFile() ? real : null;
}

function safeIncidentReportPath(workspaceRoot: string, incidentId: string): string {
  const safeIncidentId = safeName(incidentId);
  const incidents = secureDirectory(workspaceRoot, path.join(".warden", "incidents"));
  return path.join(incidents, `incident_${safeIncidentId}.md`);
}

function verifyPreviousFileOutcome(
  previous: FileOutcome,
  file: Investigation["taintedFiles"][number],
  workspaceRoot: string,
  incidentId: string,
): FileOutcome {
  if (previous.status === "restored") {
    const absolute = safeWorkspacePath(workspaceRoot, previous.path);
    const snapshot = safeSnapshotPath(workspaceRoot, file.snapshotPath);
    if (absolute && snapshot && existsSync(absolute) && hashPath(absolute) === hashPath(snapshot)) {
      return { ...previous, status: "already-resolved", message: `Verified restored file: ${previous.message}` };
    }
    return review(previous.path, "Previously restored file changed or disappeared after recovery.");
  }
  if (previous.status === "quarantined") {
    const original = safeWorkspacePath(workspaceRoot, previous.path);
    const quarantineRoot = path.join(workspaceRoot, ".warden", "quarantine", safeName(incidentId));
    const destination = safeQuarantinePath(quarantineRoot, file.path);
    const validDestination = destination && existsSync(destination) && !lstatSync(destination).isSymbolicLink()
      && inside(path.resolve(quarantineRoot), realpathSync(destination))
      && file.expectedCurrentHash && hashPath(destination) === file.expectedCurrentHash;
    if (original && !existsSync(original) && validDestination) {
      return { ...previous, status: "already-resolved", message: `Verified quarantine: ${previous.message}` };
    }
    return review(previous.path, "Quarantined file reappeared or quarantine evidence changed.");
  }
  if (previous.status === "already-resolved") {
    const absolute = safeWorkspacePath(workspaceRoot, previous.path);
    return absolute && !existsSync(absolute)
      ? previous
      : review(previous.path, "File previously recorded absent is present again.");
  }
  return previous;
}

function validState(state: IncidentState, sessionId: string): boolean {
  return state?.version === 1
    && state.sessionId === sessionId
    && /^[A-Za-z0-9._-]{1,160}$/.test(state.incidentId)
    && typeof state.rotations === "object" && state.rotations !== null
    && typeof state.files === "object" && state.files !== null;
}

function hashPath(filename: string): string {
  return createHash("sha256").update(readFileSync(filename)).digest("hex");
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function secureDirectory(rootValue: string, relativeValue: string): string {
  const root = realpathSync(rootValue);
  const relative = path.normalize(relativeValue);
  if (path.isAbsolute(relative) || relative.startsWith("..")) throw new Error("Responder directory escapes its allowed root");
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!existsSync(current)) mkdirSync(current);
    if (lstatSync(current).isSymbolicLink() || !lstatSync(current).isDirectory()) {
      throw new Error(`Unsafe responder directory: ${current}`);
    }
    const real = realpathSync(current);
    if (!inside(root, real)) throw new Error(`Responder directory escaped root: ${current}`);
    current = real;
  }
  return current;
}

function review(file: string, message: string): FileOutcome {
  return { path: file, status: "review", message: `REVIEW REQUIRED: ${message}` };
}

function canClose(rotations: readonly RotationOutcome[], files: readonly FileOutcome[]): boolean {
  return rotations.every((rotation) => rotation.oldRejected && rotation.status !== "unsupported" && rotation.status !== "verification-failed")
    && files.every((file) => file.status !== "review");
}

function agentChain(investigation: Investigation): string[] {
  const lines: string[] = [];
  for (const session of investigation.sessions) {
    lines.push(`### ${session.agent} — ${session.sessionId}`);
    lines.push("");
    if (session.originReason) lines.push(`- Trust origin: ${session.originReason}`);
    const actions = investigation.actions.filter((action) => action.sessionId === session.sessionId);
    for (const action of actions) {
      lines.push(`- ${action.kind.toUpperCase()} ${action.tool}: ${action.target || "(no target)"} → ${action.verdict ?? "observed"}`);
    }
    lines.push("");
  }
  return lines.length ? lines : ["- No session chain was available."];
}

function reviewItems(state: IncidentState): string[] {
  const items = [
    ...Object.values(state.rotations).filter((rotation) => !rotation.oldRejected).map((rotation) => `- CRITICAL: ${rotation.message}`),
    ...Object.values(state.files).filter((file) => file.status === "review").map((file) => `- ${file.path}: ${file.message}`),
  ];
  return items.length ? items : ["- None."];
}

function summarySentence(investigation: Investigation, state: IncidentState): string {
  const agents = [...new Set(investigation.sessions.map((session) => session.agent))].join(" → ") || "unknown agents";
  const keys = investigation.exposedKeys.length ? investigation.exposedKeys.join(", ") : "no real keys";
  const reviewCount = reviewItems(state)[0] === "- None." ? 0 : reviewItems(state).length;
  return `${agents} formed the recorded chain. Real exposure: ${keys}. ${reviewCount ? `${reviewCount} item(s) still need review.` : "No unresolved review items remain."}`;
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "session";
}