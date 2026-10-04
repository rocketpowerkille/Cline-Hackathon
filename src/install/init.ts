import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { SecretVault } from "../vault/secrets.js";

const MANAGED_MARKER = "WARDEN_MANAGED_HOOK v1";
// Generic preToolUse covers shell/MCP permissions. Do not also register specialized BEFORE hooks:
// the same action would be decided twice and consume twice the risk budget.
const CURSOR_EVENTS = ["preToolUse", "postToolUse", "afterShellExecution", "afterMCPExecution", "beforeSubmitPrompt"] as const;
const CLINE_EVENTS = ["PreToolUse", "PostToolUse", "TaskStart", "UserPromptSubmit"] as const;

interface ManagedFile {
  path: string;
  sha256: string;
}

interface InstallManifest {
  version: 1;
  platform: NodeJS.Platform;
  packageRoot: string;
  clineFiles: ManagedFile[];
  cursorFiles: ManagedFile[];
  cursorEntries: Array<{ event: string; command: string }>;
  gitignoreAdded: boolean;
  cursorFileCreated: boolean;
  gitignoreFileCreated: boolean;
}

export interface InstallOptions {
  root: string;
  packageRoot: string;
  platform?: NodeJS.Platform;
  nodePath?: string;
  seedEnv?: boolean;
  vault?: SecretVault;
}

export interface InstallResult {
  installed: string[];
  skipped: string[];
  warnings: string[];
  seeded: string[];
}

export interface DoctorCheck {
  status: "ok" | "warn" | "error";
  message: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}

export function installWarden(options: InstallOptions): InstallResult {
  const root = path.resolve(options.root);
  const packageRoot = path.resolve(options.packageRoot);
  const platform = options.platform ?? process.platform;
  const nodePath = options.nodePath ?? process.execPath;
  const hookLauncher = path.join(packageRoot, "bin", "hook.mjs");
  if (!existsSync(hookLauncher)) throw new Error(`Warden hook launcher not found: ${hookLauncher}`);
  if (!runtimeAvailable(packageRoot)) throw new Error("Warden requires compiled dist/ or the installed tsx runtime; run npm run build before warden init");
  const cursor = readCursorConfig(root);
  if (!cursor.ok) throw new Error(cursor.error);

  const result: InstallResult = { installed: [], skipped: [], warnings: [], seeded: [] };
  const previous = readManifest(root);
  const clineFiles: ManagedFile[] = [];
  const cursorFiles: ManagedFile[] = [];
  const cursorFilename = path.join(root, ".cursor", "hooks.json");
  const gitignoreFilename = path.join(root, ".gitignore");
  const cursorFileCreated = previous?.cursorFileCreated ?? !existsSync(cursorFilename);
  const gitignoreFileCreated = previous?.gitignoreFileCreated ?? !existsSync(gitignoreFilename);

  if (options.seedEnv) {
    if (!options.vault) throw new Error("Vault is required for --seed-env");
    const envFile = path.join(root, ".env");
    if (existsSync(envFile)) result.seeded = options.vault.seedEnv(".env").seeded;
    else result.warnings.push("Skipped vault seed: .env does not exist.");
  }

  for (const event of CLINE_EVENTS) {
    const relative = platform === "win32"
      ? path.join(".clinerules", "hooks", `${event}.ps1`)
      : path.join(".clinerules", "hooks", event);
    const absolute = path.join(root, relative);
    const content = clineHook(platform, nodePath, hookLauncher, event);
    const existing = existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
    const previousManaged = previous?.clineFiles.find((file) => file.path === relative);
    if (existing !== null && !previousManaged) {
      result.skipped.push(relative);
      result.warnings.push(`Kept existing Cline hook: ${relative}`);
      continue;
    }
    if (existing !== null && previousManaged && sha256(existing) !== previousManaged.sha256) {
      result.skipped.push(relative);
      result.warnings.push(`Kept modified Warden Cline hook: ${relative}`);
      clineFiles.push(previousManaged);
      continue;
    }
    mkdirSync(path.dirname(absolute), { recursive: true });
    if (existing !== content) {
      writeFileSync(absolute, content, "utf8");
      if (platform !== "win32") chmodSync(absolute, 0o755);
      result.installed.push(relative);
    }
    clineFiles.push({ path: relative, sha256: sha256(content) });
  }

  const cursorEntries = installCursorHooks(
    root,
    platform,
    nodePath,
    hookLauncher,
    cursor.value,
    previous?.cursorEntries ?? [],
    previous?.cursorFiles ?? [],
    cursorFiles,
    result,
  );
  const gitignoreAdded = ensureGitignore(root, previous?.gitignoreAdded ?? false, result);

  const manifest: InstallManifest = {
    version: 1,
    platform,
    packageRoot,
    clineFiles,
    cursorFiles,
    cursorEntries,
    gitignoreAdded,
    cursorFileCreated,
    gitignoreFileCreated,
  };
  writeManifest(root, manifest);

  return result;
}

export function uninstallWarden(rootValue: string): InstallResult {
  const root = path.resolve(rootValue);
  const result: InstallResult = { installed: [], skipped: [], warnings: [], seeded: [] };
  const manifest = readManifest(root);
  if (!manifest) {
    result.warnings.push("Warden install manifest is missing; nothing was removed.");
    return result;
  }

  for (const event of CLINE_EVENTS) {
    const relative = clineRelative(manifest.platform, event);
    const managed = manifest.clineFiles.find((file) => file.path === relative);
    if (!managed) continue;
    const absolute = path.join(root, relative);
    if (!existsSync(absolute)) continue;
    if (sha256(readFileSync(absolute, "utf8")) !== managed.sha256) {
      result.skipped.push(relative);
      result.warnings.push(`Kept modified Cline hook: ${relative}`);
      continue;
    }
    unlinkSync(absolute);
    result.installed.push(`removed ${relative}`);
  }

  removeCursorHooks(root, manifest, result);
  const stateRemains = wardenStateRemains(root);
  if (manifest.gitignoreAdded && !stateRemains) removeGitignoreEntry(root, manifest.gitignoreFileCreated, result);
  else if (manifest.gitignoreAdded && stateRemains) result.warnings.push("Kept .warden/ in .gitignore because Warden state remains.");
  rmSync(manifestPath(root), { force: true });
  const stateDirectory = path.join(root, ".warden");
  if (!stateRemains && existsSync(stateDirectory)) rmSync(stateDirectory, { recursive: true, force: true });
  return result;
}

export function doctorWarden(options: Omit<InstallOptions, "seedEnv" | "vault">): DoctorResult {
  const root = path.resolve(options.root);
  const packageRoot = path.resolve(options.packageRoot);
  const platform = options.platform ?? process.platform;
  const nodePath = options.nodePath ?? process.execPath;
  const launcher = path.join(packageRoot, "bin", "hook.mjs");
  const checks: DoctorCheck[] = [];
  const nodeVersion = process.versions.node.split(".").map(Number);
  checks.push({
    status: nodeVersion[0]! > 22 || (nodeVersion[0] === 22 && nodeVersion[1]! >= 13) ? "ok" : "error",
    message: `Node ${process.versions.node} (requires 22.13+)`,
  });
  checks.push({ status: existsSync(launcher) ? "ok" : "error", message: `Hook launcher: ${launcher}` });
  checks.push({ status: runtimeAvailable(packageRoot) ? "ok" : "error", message: "compiled or tsx runtime loader is available" });
  checks.push({ status: gitignoreHasWarden(root) ? "ok" : "error", message: ".warden/ is ignored by Git" });

  for (const event of CLINE_EVENTS) {
    const relative = clineRelative(platform, event);
    const absolute = path.join(root, relative);
    const expected = clineHook(platform, nodePath, launcher, event);
    const current = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
    checks.push({
      status: current === expected ? "ok" : "error",
      message: current === expected ? `Cline ${event} hook installed` : current ? `Cline ${event} hook is occupied by another script` : `Cline ${event} hook missing`,
    });
  }

  const cursor = readCursorConfig(root);
  for (const event of CURSOR_EVENTS) {
    const command = cursorCommand(platform, event);
    const installed = cursor.ok && cursor.value.hooks[event]?.some((entry) => entry.command === command);
    const wrapper = path.join(root, cursorRelative(platform, event));
    const expected = cursorWrapper(platform, nodePath, launcher, event);
    const current = existsSync(wrapper) ? readFileSync(wrapper, "utf8") : "";
    checks.push({
      status: current === expected ? "ok" : "error",
      message: current === expected ? `Cursor ${event} wrapper installed` : current ? `Cursor ${event} wrapper is modified` : `Cursor ${event} wrapper missing`,
    });
    checks.push({ status: installed ? "ok" : "error", message: `Cursor ${event} hook ${installed ? "installed" : "missing"}` });
  }
  checks.push({ status: "warn", message: "Confirm Cline's Enable Hooks setting is turned on in the IDE." });
  return { ok: !checks.some((check) => check.status === "error"), checks };
}

function installCursorHooks(
  root: string,
  platform: NodeJS.Platform,
  nodePath: string,
  launcher: string,
  config: CursorConfig,
  previouslyManaged: InstallManifest["cursorEntries"],
  previousFiles: ManagedFile[],
  installedFiles: ManagedFile[],
  result: InstallResult,
): Array<{ event: string; command: string }> {
  const installed: Array<{ event: string; command: string }> = [];
  let changed = false;
  for (const event of CURSOR_EVENTS) {
    const relative = cursorRelative(platform, event);
    const absolute = path.join(root, relative);
    const content = cursorWrapper(platform, nodePath, launcher, event);
    const previousFile = previousFiles.find((file) => file.path === relative);
    const existing = existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
    if (existing !== null && !previousFile) {
      result.skipped.push(relative);
      result.warnings.push(`Kept existing Cursor wrapper: ${relative}`);
      continue;
    }
    if (existing !== null && previousFile && sha256(existing) !== previousFile.sha256) {
      result.skipped.push(relative);
      result.warnings.push(`Kept modified Cursor wrapper: ${relative}`);
      installedFiles.push(previousFile);
      continue;
    }
    mkdirSync(path.dirname(absolute), { recursive: true });
    if (existing !== content) {
      writeFileSync(absolute, content, "utf8");
      if (platform !== "win32") chmodSync(absolute, 0o755);
      result.installed.push(relative);
    }
    installedFiles.push({ path: relative, sha256: sha256(content) });

    const command = cursorCommand(platform, event);
    const entries = config.hooks[event] ??= [];
    const exists = entries.some((entry) => entry.command === command);
    const owned = previouslyManaged.some((entry) => entry.event === event && entry.command === command);
    if (!exists) {
      entries.push({ command, timeout: 30 });
      result.installed.push(`.cursor/hooks.json:${event}`);
      installed.push({ event, command });
      changed = true;
    } else if (owned) {
      installed.push({ event, command });
    } else {
      result.warnings.push(`Kept pre-existing Cursor hook: ${event}`);
    }
  }
  if (changed) writeCursorConfig(root, config);
  return installed;
}

function removeCursorHooks(root: string, manifest: InstallManifest, result: InstallResult): void {
  const parsed = readCursorConfig(root);
  if (!parsed.ok) {
    result.warnings.push(parsed.error);
    return;
  }
  let changed = false;
  for (const event of CURSOR_EVENTS) {
    const command = cursorCommand(manifest.platform, event);
    if (!manifest.cursorEntries.some((entry) => entry.event === event && entry.command === command)) continue;
    const entries = parsed.value.hooks[event];
    if (!entries) continue;
    const index = entries.findIndex((entry) => entry.command === command);
    if (index < 0) continue;
    const kept = [...entries];
    kept.splice(index, 1);
    changed = true;
    result.installed.push(`removed .cursor/hooks.json:${event}`);
    if (kept.length) parsed.value.hooks[event] = kept;
    else delete parsed.value.hooks[event];
  }
  const filename = path.join(root, ".cursor", "hooks.json");
  if (changed && manifest.cursorFileCreated && Object.keys(parsed.value.hooks).length === 0) {
    rmSync(filename, { force: true });
  } else if (changed) {
    writeCursorConfig(root, parsed.value);
  }

  for (const event of CURSOR_EVENTS) {
    const relative = cursorRelative(manifest.platform, event);
    const managed = manifest.cursorFiles.find((file) => file.path === relative);
    if (!managed) continue;
    const absolute = path.join(root, relative);
    if (!existsSync(absolute)) continue;
    if (sha256(readFileSync(absolute, "utf8")) !== managed.sha256) {
      result.skipped.push(relative);
      result.warnings.push(`Kept modified Cursor wrapper: ${relative}`);
      continue;
    }
    unlinkSync(absolute);
    result.installed.push(`removed ${relative}`);
  }
  removeEmptyDirectory(path.join(root, ".warden", "hooks"));
}

interface CursorEntry { command: string; timeout?: number; matcher?: string }
interface CursorConfig { version: 1; hooks: Record<string, CursorEntry[]>; [key: string]: unknown }

function readCursorConfig(root: string): { ok: true; value: CursorConfig } | { ok: false; error: string } {
  const filename = path.join(root, ".cursor", "hooks.json");
  if (!existsSync(filename)) return { ok: true, value: { version: 1, hooks: {} } };
  try {
    const value = JSON.parse(readFileSync(filename, "utf8")) as Partial<CursorConfig>;
    if (value.version !== 1 || !value.hooks || typeof value.hooks !== "object") throw new Error("unsupported schema");
    for (const entries of Object.values(value.hooks)) if (!Array.isArray(entries)) throw new Error("hook entries must be arrays");
    return { ok: true, value: value as CursorConfig };
  } catch (error) {
    return { ok: false, error: `Cannot safely merge .cursor/hooks.json: ${error instanceof Error ? error.message : "invalid JSON"}` };
  }
}

function writeCursorConfig(root: string, config: CursorConfig): void {
  const filename = path.join(root, ".cursor", "hooks.json");
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function ensureGitignore(root: string, previouslyAdded: boolean, result: InstallResult): boolean {
  const filename = path.join(root, ".gitignore");
  const current = existsSync(filename) ? readFileSync(filename, "utf8") : "";
  if (gitignoreLines(current).includes(".warden/")) return previouslyAdded;
  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  writeFileSync(filename, `${current}${prefix}.warden/\n`, "utf8");
  result.installed.push(".gitignore:.warden/");
  return true;
}

function removeGitignoreEntry(root: string, removeEmptyFile: boolean, result: InstallResult): void {
  const filename = path.join(root, ".gitignore");
  if (!existsSync(filename)) return;
  const lines = readFileSync(filename, "utf8").split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() === ".warden/");
  if (index < 0) return;
  lines.splice(index, 1);
  const content = lines.join("\n").replace(/\n+$/, "\n");
  if (removeEmptyFile && content.trim() === "") rmSync(filename, { force: true });
  else writeFileSync(filename, content, "utf8");
  result.installed.push("removed .gitignore:.warden/");
}

function gitignoreHasWarden(root: string): boolean {
  const filename = path.join(root, ".gitignore");
  return existsSync(filename) && gitignoreLines(readFileSync(filename, "utf8")).includes(".warden/");
}

function gitignoreLines(content: string): string[] {
  return content.split(/\r?\n/).map((line) => line.trim());
}

function clineHook(platform: NodeJS.Platform, nodePath: string, launcher: string, event: string): string {
  if (platform === "win32") {
    return `# ${MANAGED_MARKER}\n& '${psQuote(nodePath)}' '${psQuote(launcher)}' cline ${event}\nexit $LASTEXITCODE\n`;
  }
  return `#!/bin/sh\n# ${MANAGED_MARKER}\nexec '${shQuote(nodePath)}' '${shQuote(launcher)}' cline ${event}\n`;
}

function clineRelative(platform: NodeJS.Platform, event: string): string {
  return platform === "win32"
    ? path.join(".clinerules", "hooks", `${event}.ps1`)
    : path.join(".clinerules", "hooks", event);
}

function cursorRelative(platform: NodeJS.Platform, event: string): string {
  return platform === "win32"
    ? path.join(".warden", "hooks", `cursor-${event}.ps1`)
    : path.join(".warden", "hooks", `cursor-${event}`);
}

function cursorCommand(platform: NodeJS.Platform, event: string): string {
  return platform === "win32"
    ? `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .warden/hooks/cursor-${event}.ps1`
    : `./.warden/hooks/cursor-${event}`;
}

function cursorWrapper(platform: NodeJS.Platform, nodePath: string, launcher: string, event: string): string {
  if (platform === "win32") {
    return `# ${MANAGED_MARKER}\n& '${psQuote(nodePath)}' '${psQuote(launcher)}' cursor ${event}\nexit $LASTEXITCODE\n`;
  }
  return `#!/bin/sh\n# ${MANAGED_MARKER}\nexec '${shQuote(nodePath)}' '${shQuote(launcher)}' cursor ${event}\n`;
}

function shQuote(value: string): string {
  return value.replaceAll("'", "'\\''");
}

function psQuote(value: string): string {
  return value.replaceAll("'", "''");
}

function manifestPath(root: string): string {
  return path.join(root, ".warden", "install.json");
}

function wardenStateRemains(root: string): boolean {
  const directory = path.join(root, ".warden");
  if (!existsSync(directory)) return false;
  return readDirectory(directory).some((entry) => entry !== "install.json");
}

function readDirectory(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return ["unreadable-state"];
  }
}

function removeEmptyDirectory(directory: string): void {
  if (existsSync(directory) && readDirectory(directory).length === 0) rmSync(directory, { recursive: true, force: true });
}

function readManifest(root: string): InstallManifest | null {
  const filename = manifestPath(root);
  if (!existsSync(filename)) return null;
  try {
    const value = JSON.parse(readFileSync(filename, "utf8")) as InstallManifest;
    return value.version === 1 ? { ...value, cursorFiles: value.cursorFiles ?? [] } : null;
  } catch {
    return null;
  }
}

function writeManifest(root: string, manifest: InstallManifest): void {
  const filename = manifestPath(root);
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function tsxAvailable(packageRoot: string): boolean {
  try {
    createRequire(path.join(packageRoot, "package.json")).resolve("tsx/esm/api");
    return true;
  } catch {
    return false;
  }
}

function runtimeAvailable(packageRoot: string): boolean {
  return (existsSync(path.join(packageRoot, "dist", "hooks", "main.js"))
    && existsSync(path.join(packageRoot, "dist", "cli", "warden.js")))
    || tsxAvailable(packageRoot);
}