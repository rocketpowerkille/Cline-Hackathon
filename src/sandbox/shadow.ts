import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { AgentAction } from "../core/types.js";
import { scanWardenCanaries } from "../vault/secrets.js";

const DEFAULT_IMAGE = "node:22-alpine";
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_OUTPUT = 64 * 1024;
const MAX_SCRIPT_BYTES = 256 * 1024;
const MAX_SCRIPT_FILES = 20;
const MAX_SCRIPT_DEPTH = 3;

const ignoredRoots = new Set([".git", ".warden", "node_modules", "dist", "coverage"]);
const secretBasenames = new Set([
  ".env", ".env.local", ".npmrc", ".pypirc", ".netrc", "id_rsa", "id_ed25519", "credentials",
]);
const secretExtensions = /\.(?:pem|p12|pfx|key|kdbx)$/i;
const controlBasenames = new Set(["agents.md", "claude.md", ".clinerules", ".cursorrules", "mcp.json", ".mcp.json", ".bashrc", ".zshrc", ".profile"]);

export type SandboxBackend = "docker" | "static";

export interface SandboxEvidence {
  backend: SandboxBackend;
  inspectedFiles: string[];
  changedFiles: string[];
  secretFiles: string[];
  tokenReferences: string[];
  canaries: string[];
  networkAttempts: string[];
  controlFiles: string[];
  obfuscation: string[];
  outsideWorkspace: string[];
  exitCode: number | null;
  timedOut: boolean;
  executionError: string | null;
  labels: string[];
}

export interface SandboxResult {
  verdict: "allow" | "block";
  reason: string;
  evidence: SandboxEvidence;
}

export interface SandboxRequest {
  workspaceRoot: string;
  action: AgentAction;
  timeoutMs?: number;
  image?: string;
  docker?: string;
  record?: (result: SandboxResult) => void;
}

export function shadowRun(request: SandboxRequest): SandboxResult {
  const workspaceRoot = realpathSync(request.workspaceRoot);
  const staticEvidence = inspectStatically(workspaceRoot, request.action);
  const image = request.image ?? process.env.WARDEN_SANDBOX_IMAGE ?? DEFAULT_IMAGE;
  const docker = request.docker ?? "docker";
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const useDocker = supportsDockerCommand(request.action) && dockerReady(docker, image);
  const evidence = useDocker
    ? runDockerShadow(workspaceRoot, request.action, staticEvidence, { docker, image, timeoutMs })
    : { ...staticEvidence, backend: "static" as const, labels: unique([...staticEvidence.labels, "sandbox:static-fallback"]) };
  const result = decide(evidence);
  request.record?.(result);
  return result;
}

export function dockerReady(docker = "docker", image = process.env.WARDEN_SANDBOX_IMAGE ?? DEFAULT_IMAGE): boolean {
  const version = spawnSync(docker, ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
    timeout: 800,
    windowsHide: true,
    env: dockerClientEnvironment(),
  });
  if (version.status !== 0 || !version.stdout.trim()) return false;
  const inspect = spawnSync(docker, ["image", "inspect", "--format", "{{json .Config.Env}}", image], {
    encoding: "utf8",
    timeout: 800,
    windowsHide: true,
    env: dockerClientEnvironment(),
  });
  if (inspect.status !== 0) return false;
  try {
    const environment = JSON.parse(inspect.stdout.trim() || "[]") as string[];
    return !environment.some((entry) => /^(?:[^=]*(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY|PRIVATE[_-]?KEY))=/i.test(entry));
  } catch {
    return false;
  }
}

function inspectStatically(workspaceRoot: string, action: AgentAction): SandboxEvidence {
  const command = action.target || action.content;
  const collected = collectSources(workspaceRoot, command, action.content);
  const sources = collected.sources;
  const combined = sources.map((source) => source.content).join("\n");
  const secretFiles = findSecretReferences(combined);
  const tokenReferences = findMatches(combined, [
    /\bprocess\.env\.[A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)\b/gi,
    /\bprocess\.env\s*\[\s*["'][A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)["']\s*\]/gi,
    /\{[^}]*\b[A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)\b[^}]*\}\s*=\s*process\.env/gi,
    /\bprocess\.env\s*\[/gi,
    /\$env:[A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)\b/gi,
    /\$\{?[A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)\}?/gi,
    /%[A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)%/gi,
    /\b(?:ghp_|github_pat_|npm_|sk-)[A-Za-z0-9_-]{16,}\b/g,
    /\bAKIA[A-Z0-9]{16}\b/g,
  ]);
  const networkAttempts = findNetworkAttempts(combined);
  const controlFiles = findControlWriteIntents(combined);
  const obfuscation = findMatches(combined, [
    /\bbase64\b/gi,
    /\bopenssl\s+base64\b/gi,
    /\bcertutil\b[^\r\n]*(?:-encode|-decode)/gi,
    /ToBase64String/gi,
    /toString\s*\(\s*["']base64["']\s*\)/gi,
    /\bxxd\s+(?:-[pr]|-i)/gi,
  ]);
  const canaries = scanWardenCanaries(combined);
  const labels = evidenceLabels({
    secretFiles, tokenReferences, canaries, networkAttempts, controlFiles, obfuscation,
    outsideWorkspace: collected.outsideWorkspace, timedOut: false,
  });

  return {
    backend: "static",
    inspectedFiles: sources.map((source) => source.path).filter(Boolean),
    changedFiles: [],
    secretFiles,
    tokenReferences,
    canaries,
    networkAttempts,
    controlFiles,
    obfuscation,
    outsideWorkspace: collected.outsideWorkspace,
    exitCode: null,
    timedOut: false,
    executionError: null,
    labels,
  };
}

interface DockerOptions {
  docker: string;
  image: string;
  timeoutMs: number;
}

function runDockerShadow(
  workspaceRoot: string,
  action: AgentAction,
  staticEvidence: SandboxEvidence,
  options: DockerOptions,
): SandboxEvidence {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "warden-shadow-"));
  const shadow = path.join(temporaryRoot, "workspace");
  const tools = path.join(temporaryRoot, "tools");
  const containerName = `warden-shadow-${randomUUID()}`;

  try {
    copyWorkspace(workspaceRoot, shadow);
    writeNetworkWrappers(tools);
    const before = fileManifest(shadow);
    const command = action.target || action.content;
    const args = [
      "run", "--rm", "--pull=never", "--name", containerName,
      "--network", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--pids-limit", "128", "--memory", "512m", "--cpus", "1",
      "--mount", `type=bind,src=${shadow},dst=/workspace`,
      "--mount", `type=bind,src=${tools},dst=/warden-tools,readonly`,
      "--workdir", "/workspace",
      "--env", "PATH=/warden-tools:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      "--env", "HOME=/tmp/warden-home", "--env", "CI=1", "--env", "WARDEN_SANDBOX=1",
      options.image, "sh", "-c", command,
    ];
    const execution = spawnSync(options.docker, args, {
      encoding: "utf8",
      timeout: options.timeoutMs,
      maxBuffer: MAX_OUTPUT,
      windowsHide: true,
      env: dockerClientEnvironment(),
    });
    const timedOut = Boolean(execution.error && "code" in execution.error && execution.error.code === "ETIMEDOUT");
    const executionError = execution.error && !timedOut ? execution.error.name : null;
    if (timedOut) removeContainer(options.docker, containerName);

    const after = fileManifest(shadow);
    const changedFiles = changedManifestPaths(before, after);
    const runtimeText = `${limit(execution.stdout)}\n${limit(execution.stderr)}\n${readNetworkLog(shadow)}`;
    const runtimeCanaries = scanWardenCanaries(runtimeText);
    const networkAttempts = unique([...staticEvidence.networkAttempts, ...parseNetworkLog(readNetworkLog(shadow)), ...connectionFailures(runtimeText)]);
    const controlFiles = unique([
      ...staticEvidence.controlFiles,
      ...changedFiles.filter(isControlPath),
    ]);
    const canaries = unique([...staticEvidence.canaries, ...runtimeCanaries, ...scanChangedFilesForCanaries(shadow, changedFiles)]);
    const labels = evidenceLabels({
      secretFiles: staticEvidence.secretFiles,
      tokenReferences: staticEvidence.tokenReferences,
      canaries,
      networkAttempts,
      controlFiles,
      obfuscation: staticEvidence.obfuscation,
      outsideWorkspace: staticEvidence.outsideWorkspace,
      timedOut,
      executionError,
    });

    return {
      ...staticEvidence,
      backend: "docker",
      changedFiles,
      canaries,
      networkAttempts,
      controlFiles,
      exitCode: execution.status,
      timedOut,
      executionError,
      labels,
    };
  } finally {
    removeContainer(options.docker, containerName);
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function decide(evidence: SandboxEvidence): SandboxResult {
  const reasons: string[] = [];
  if (evidence.secretFiles.length || evidence.tokenReferences.length) reasons.push("accessed secret material");
  if (evidence.canaries.length) reasons.push("exposed a Warden canary");
  if (evidence.networkAttempts.length) reasons.push("attempted network access");
  if (evidence.controlFiles.length) reasons.push("changed an agent control file");
  if (evidence.outsideWorkspace.length) reasons.push("referenced a script outside the protected repository");
  if (evidence.timedOut) reasons.push("exceeded the sandbox time limit");
  if (evidence.executionError) reasons.push("failed during sandbox execution");
  return reasons.length > 0
    ? { verdict: "block", reason: `Blocked: sandbox ${reasons.join(", ")}.`, evidence }
    : { verdict: "allow", reason: "Allowed: sandbox found no secret, network, or control-file activity.", evidence };
}

interface SourceText { path: string; content: string; depth: number }
interface CollectedSources { sources: SourceText[]; outsideWorkspace: string[] }

function collectSources(workspaceRoot: string, command: string, content: string): CollectedSources {
  const sources: SourceText[] = [{ path: "", content: `${command}\n${content}`, depth: 0 }];
  const seen = new Set<string>();
  const outsideWorkspace: string[] = [];
  let bytes = sources[0]!.content.length;

  for (let index = 0; index < sources.length && seen.size < MAX_SCRIPT_FILES; index += 1) {
    const source = sources[index]!;
    if (source.depth >= MAX_SCRIPT_DEPTH) continue;
    for (const candidate of scriptCandidates(source.content)) {
      const resolved = resolveWorkspaceFile(workspaceRoot, candidate);
      if (resolved.outside) outsideWorkspace.push(candidate);
      const absolute = resolved.absolute;
      if (!absolute || seen.has(absolute) || isSecretPath(path.relative(workspaceRoot, absolute))) continue;
      const size = statSync(absolute).size;
      if (size > MAX_SCRIPT_BYTES || bytes + size > MAX_SCRIPT_BYTES) continue;
      const script = readFileSync(absolute, "utf8");
      seen.add(absolute);
      bytes += script.length;
      sources.push({ path: slash(path.relative(workspaceRoot, absolute)), content: script, depth: source.depth + 1 });
    }
  }
  return { sources, outsideWorkspace: unique(outsideWorkspace) };
}

function scriptCandidates(text: string): string[] {
  const candidates = new Set<string>();
  for (const match of text.matchAll(/(?:^|[\s"'])([^\s"';&|<>]+\.(?:sh|bash|zsh|ps1|js|mjs|cjs|py|bat|cmd))(?:$|[\s"';&|<>])/gim)) {
    candidates.add(match[1]!);
  }
  for (const match of text.matchAll(/(?:^|[\s"'])(\.\.?[\\/][^\s"';&|<>]+)(?:$|[\s"';&|<>])/gim)) {
    candidates.add(match[1]!);
  }
  return [...candidates];
}

function resolveWorkspaceFile(root: string, candidate: string): { absolute: string | null; outside: boolean } {
  const absolute = path.resolve(root, candidate.replace(/^['"]|['"]$/g, ""));
  if (!isInside(root, absolute)) return { absolute: null, outside: true };
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return { absolute: null, outside: false };
  const real = realpathSync(absolute);
  return isInside(root, real) ? { absolute: real, outside: false } : { absolute: null, outside: true };
}

function findSecretReferences(text: string): string[] {
  return findMatches(text, [
    /(?:^|[\\/\s"'])\.env(?:\.[A-Za-z0-9_-]+)?\b/gi,
    /(?:^|[\\/\s"'])\.(?:npmrc|pypirc)\b/gi,
    /(?:^|[\\/\s"'])(?:id_rsa|id_ed25519)\b/gi,
    /(?:^|[\\/\s"'])\.aws[\\/]credentials\b/gi,
    /[^\s"']+\.(?:pem|p12)\b/gi,
  ]).map((value) => value.trim());
}

function findNetworkAttempts(text: string): string[] {
  return findMatches(text, [
    /\b(?:curl|wget)\b[^\r\n;]*/gi,
    /\bInvoke-(?:WebRequest|RestMethod)\b[^\r\n;]*/gi,
    /\b(?:fetch|axios\.(?:get|post|put|patch|delete)|https?\.request|net\.connect)\s*\([^\r\n;]*/gi,
    /\b(?:nc|ncat|telnet)\b[^\r\n;]*/gi,
    /https?:\/\/[^\s"')]+/gi,
  ]);
}

function findControlWriteIntents(text: string): string[] {
  const results: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/(?:>|>>|\btee\b|\bsed\s+-i\b|Set-Content|Add-Content|Out-File|writeFile|appendFile|Copy-Item|Move-Item)/i.test(line)) continue;
    for (const candidate of controlCandidates(line)) results.push(candidate);
  }
  return unique(results);
}

function controlCandidates(text: string): string[] {
  const patterns = [
    /(?:AGENTS\.md|CLAUDE\.md|\.clinerules|\.cursorrules|mcp\.json|\.mcp\.json|\.bashrc|\.zshrc|\.profile)/gi,
    /\.cursor[\\/](?:rules|hooks\.json)/gi,
    /\.vscode[\\/](?:settings|tasks)\.json/gi,
    /\.git[\\/]hooks[\\/][^\s"']+/gi,
    /\.github[\\/]workflows[\\/][^\s"']+/gi,
  ];
  return findMatches(text, patterns);
}

function isControlPath(relativePath: string): boolean {
  const normalized = slash(relativePath).toLowerCase();
  const base = path.posix.basename(normalized);
  return controlBasenames.has(base)
    || normalized === ".cursor/hooks.json"
    || normalized.startsWith(".cursor/rules/")
    || normalized === ".vscode/settings.json"
    || normalized === ".vscode/tasks.json"
    || normalized.startsWith(".git/hooks/")
    || normalized.startsWith(".github/workflows/");
}

function evidenceLabels(input: {
  secretFiles: string[]; tokenReferences: string[]; canaries: string[]; networkAttempts: string[];
  controlFiles: string[]; obfuscation: string[]; timedOut: boolean;
  outsideWorkspace: string[];
  executionError?: string | null;
}): string[] {
  const labels: string[] = [];
  if (input.secretFiles.length || input.tokenReferences.length) labels.push("sandbox:secret-access");
  if (input.canaries.length) labels.push("sandbox:canary");
  if (input.networkAttempts.length) labels.push("sandbox:network");
  if (input.controlFiles.length) labels.push("sandbox:control-file");
  if (input.obfuscation.length) labels.push("sandbox:obfuscation");
  if (input.outsideWorkspace.length) labels.push("sandbox:outside-workspace");
  if (input.timedOut) labels.push("sandbox:timeout");
  if (input.executionError) labels.push("sandbox:error");
  return labels;
}

function copyWorkspace(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    dereference: false,
    filter: (entry) => {
      const relative = slash(path.relative(source, entry));
      if (!relative) return true;
      const root = relative.split("/")[0]!;
      if (ignoredRoots.has(root)) return false;
      if (lstatSync(entry).isSymbolicLink()) return false;
      return !isSecretPath(relative);
    },
  });
  for (const relative of secretPaths(source)) {
    const target = path.join(destination, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, sanitizedSecretFile(path.join(source, relative), relative), "utf8");
  }
  redactCopiedText(destination);
  mkdirSync(path.join(destination, ".warden-sandbox"), { recursive: true });
}

function secretPaths(root: string): string[] {
  const results: string[] = [];
  walk(root, (absolute, relative, directory) => {
    if (directory) return !ignoredRoots.has(relative.split("/")[0]!);
    if (isSecretPath(relative)) results.push(relative);
    return true;
  });
  return results;
}

function sanitizedSecretFile(source: string, relative: string): string {
  if (path.basename(relative).toLowerCase().startsWith(".env")) {
    const names = readFileSync(source, "utf8")
      .split(/\r?\n/)
      .map((line) => /^(?:\s*export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1])
      .filter((name): name is string => Boolean(name));
    return names.map((name) => `${name}=__WARDEN_CANARY__${name}__000000000000000000000000__`).join("\n") + "\n";
  }
  return "WARDEN_SANDBOX_SECRET=__WARDEN_CANARY__SANDBOX_SECRET__000000000000000000000000__\n";
}

function isSecretPath(relativePath: string): boolean {
  const normalized = slash(relativePath).toLowerCase();
  const base = path.posix.basename(normalized);
  return base.startsWith(".env")
    || secretBasenames.has(base)
    || normalized === ".docker/config.json"
    || normalized === ".kube/config"
    || normalized === ".aws/config"
    || normalized.endsWith("/.aws/credentials")
    || normalized === ".aws/credentials"
    || secretExtensions.test(base);
}

function redactCopiedText(root: string): void {
  walk(root, (absolute, relative, directory) => {
    if (directory || relative.startsWith(".warden-sandbox/")) return true;
    const size = statSync(absolute).size;
    if (size > 1024 * 1024) return true;
    const buffer = readFileSync(absolute);
    if (buffer.includes(0)) return true;
    const original = buffer.toString("utf8");
    const redacted = original
      .replace(
        /\b([A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY|PRIVATE[_-]?KEY)[A-Za-z0-9_]*)\s*=\s*([^\r\n]+)/gi,
        (_match, name: string) => `${name}=__WARDEN_CANARY__${name.replace(/[^A-Za-z0-9_]/g, "_")}__000000000000000000000000__`,
      )
      .replace(/\b(?:ghp_|github_pat_|npm_|sk-)[A-Za-z0-9_-]{16,}\b/g, "__WARDEN_CANARY__INLINE_SECRET__000000000000000000000000__")
      .replace(/\bAKIA[A-Z0-9]{16}\b/g, "__WARDEN_CANARY__AWS_ACCESS_KEY__000000000000000000000000__");
    if (redacted !== original) writeFileSync(absolute, redacted, "utf8");
    return true;
  });
}

function writeNetworkWrappers(directory: string): void {
  mkdirSync(directory, { recursive: true });
  for (const name of ["curl", "wget"]) {
    const filename = path.join(directory, name);
    writeFileSync(filename, `#!/bin/sh\nprintf '%s\\t' '${name}' >> /workspace/.warden-sandbox/network.log\nprintf '%s ' "$@" >> /workspace/.warden-sandbox/network.log\nprintf '\\n' >> /workspace/.warden-sandbox/network.log\nexit 7\n`, "utf8");
    chmodSync(filename, 0o755);
  }
}

function readNetworkLog(shadow: string): string {
  const filename = path.join(shadow, ".warden-sandbox", "network.log");
  return existsSync(filename) ? limit(readFileSync(filename, "utf8")) : "";
}

function parseNetworkLog(log: string): string[] {
  return log.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function connectionFailures(text: string): string[] {
  return text.split(/\r?\n/)
    .filter((line) => /(?:could not resolve|connection refused|network is unreachable|failed to connect)/i.test(line))
    .map((line) => line.trim());
}

type Manifest = Map<string, string>;

function fileManifest(root: string): Manifest {
  const manifest: Manifest = new Map();
  walk(root, (absolute, relative, directory) => {
    if (relative.startsWith(".warden-sandbox/")) return false;
    if (!directory) manifest.set(relative, createHash("sha256").update(readFileSync(absolute)).digest("hex"));
    return true;
  });
  return manifest;
}

function changedManifestPaths(before: Manifest, after: Manifest): string[] {
  return unique([...before.keys(), ...after.keys()].filter((name) => before.get(name) !== after.get(name))).sort();
}

function scanChangedFilesForCanaries(root: string, changedFiles: readonly string[]): string[] {
  const canaries: string[] = [];
  for (const relative of changedFiles) {
    const absolute = path.join(root, relative);
    if (!existsSync(absolute) || !statSync(absolute).isFile() || statSync(absolute).size > MAX_OUTPUT) continue;
    canaries.push(...scanWardenCanaries(readFileSync(absolute, "utf8")));
  }
  return unique(canaries);
}

function walk(root: string, visit: (absolute: string, relative: string, directory: boolean) => boolean): void {
  const pending = [root];
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = slash(path.relative(root, absolute));
      if (entry.isSymbolicLink()) continue;
      if (!visit(absolute, relative, entry.isDirectory())) continue;
      if (entry.isDirectory()) pending.push(absolute);
    }
  }
}

function dockerClientEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE", "DOCKER_HOST", "DOCKER_CONTEXT"];
  return Object.fromEntries(allowed.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]])) as NodeJS.ProcessEnv;
}

function removeContainer(docker: string, name: string): void {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const removal = spawnSync(docker, ["rm", "-f", name], {
      encoding: "utf8",
      timeout: 1_500,
      windowsHide: true,
      env: dockerClientEnvironment(),
    });
    if (removal.status === 0 || /No such container/i.test(removal.stderr)) return;
  }
}

function supportsDockerCommand(action: AgentAction): boolean {
  const command = action.target || action.content;
  return action.kind === "exec" && !/(?:^|\s)(?:powershell(?:\.exe)?|pwsh(?:\.exe)?|cmd(?:\.exe)?)(?:\s|$)/i.test(command) && !/\b[A-Za-z]:\\/.test(command);
}

function findMatches(text: string, patterns: readonly RegExp[]): string[] {
  const matches: string[] = [];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) matches.push(match[0]);
  return unique(matches.map((value) => value.trim()).filter(Boolean));
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function slash(value: string): string {
  return value.split(path.sep).join("/");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function limit(value: string | Buffer | null | undefined): string {
  return String(value ?? "").slice(0, MAX_OUTPUT);
}