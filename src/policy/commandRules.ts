import type { ShellSegment } from "./targets.js";

const shortFlags = /^-[rfivdRF]+$/;
const isRecursive = (arg: string) => (shortFlags.test(arg) && /r/i.test(arg)) || /^(?:--recursive|-recurse|\/s)$/i.test(arg);
const isForce = (arg: string) => (shortFlags.test(arg) && /f/i.test(arg)) || /^(?:--force|-force|-fo|\/q)$/i.test(arg);
const deleteVerbs = new Set(["rm", "remove-item", "ri", "del", "erase", "rmdir", "rd"]);

/** Operands of a recursive, forced delete, or null when the segment is not one. */
export function forcedDeleteTargets(segment: ShellSegment): string[] | null {
  if (!deleteVerbs.has(segment.verb)) return null;
  if (!segment.args.some(isRecursive) || !segment.args.some(isForce)) return null;
  return segment.args.filter((arg) => !arg.startsWith("-") && !/^\/[sq]$/i.test(arg));
}

/** Regenerable directories that developers routinely wipe. */
export const buildArtifacts = new Set([
  "node_modules", "dist", "build", "out", "coverage", ".next", ".nuxt", ".turbo", ".cache",
  ".parcel-cache", ".pytest_cache", "__pycache__", "target", "tmp", ".tmp",
]);

const destructivePatterns: [RegExp, string][] = [
  [/\bgit\b.*\bpush\b.*(?:\s--force(?:-with-lease)?\b|\s-f\b|\s--mirror\b|\s--delete\b|\s-d\b|\s\+\S|\s:\S)/i, "git force/delete push"],
  [/\bgit\b.*\breset\b.*\s--hard\b/i, "git reset --hard"],
  [/\bgit\b.*\bclean\b.*\s-[a-z]*f/i, "git clean -f"],
  [/\bgit\b.*\bbranch\b.*\s-D\b/, "git branch -D"],
  [/\bgit\b.*\bfilter-(?:branch|repo)\b/i, "git history rewrite"],
  [/\b(?:drop\s+(?:table|database|schema|collection)|truncate\s+table)\b/i, "SQL drop/truncate"],
  [/\bdelete\s+from\s+[\w."`\[\]]+\s*(?:;|"|'|$)/i, "SQL delete without WHERE"],
  [/\b(?:dropdb|flushall|flushdb)\b|\.dropdatabase\(/i, "database wipe"],
  [/\bfind\b.*\s(?:-delete\b|-exec\s+rm\b)/i, "find -delete"],
  [/\bmkfs(?:\.\w+)?\b|\bdd\b.*\bof=\/dev\/|\bformat\s+[a-z]:|\bformat-volume\b|\bdiskpart\b|\bclear-disk\b/i, "disk wipe"],
  [/\bvssadmin\b.*\bdelete\b|\bcipher\b.*\s\/w/i, "shadow copy / free-space wipe"],
  [/\b(?:npm|pnpm|yarn)\s+unpublish\b|\bgh\s+(?:repo|release)\s+delete\b/i, "package/repo delete"],
  [/\bterraform\s+destroy\b|\bkubectl\s+delete\b|\bdocker\s+(?:system|volume)\s+prune\b|\baws\s+s3\s+(?:rb\b|rm\b.*--recursive)/i, "infrastructure destroy"],
];

/** Named destructive operation in one segment, or null. Patterns run per segment, so `.*` stays local. */
export function destructiveOperation(segmentText: string): string | null {
  return destructivePatterns.find(([pattern]) => pattern.test(segmentText))?.[1] ?? null;
}

const fetcher = String.raw`(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)`;
const interpreter = String.raw`(?:sh|bash|zsh|dash|ksh|python3?|node|perl|ruby|iex|invoke-expression|powershell|pwsh)`;
const remoteExecPatterns = [
  new RegExp(String.raw`\b${fetcher}\b[^;&\n]*\|\s*(?:sudo\s+)?(?:\S*[\\/])?${interpreter}(?:\.exe)?\b`, "i"),
  new RegExp(String.raw`\b${interpreter}\b[^;\n]*(?:<\(|\$\(|\x60)\s*${fetcher}\b`, "i"),
  /\b(?:iex|invoke-expression)\b[^;\n]*(?:\.downloadstring\b|\(\s*(?:iwr|irm|invoke-webrequest|invoke-restmethod)\b)/i,
];

/** Downloads code and runs it without it ever landing on disk for review. Checked on the whole line. */
export function isRemoteExec(command: string): boolean {
  return remoteExecPatterns.some((pattern) => pattern.test(command));
}

const egressPatterns = [
  /\bgit\b.*\bpush\b/i,
  /\bgh\s+(?:issue|pr|gist|release|repo|discussion)\s+(?:comment|create|edit|review|merge|close|reopen|upload)\b/i,
  /\bgh\s+api\b.*(?:\s(?:-X|--method)\s*(?:post|put|patch|delete)\b|\s(?:-f|-F|--field|--raw-field|--input)\b)/i,
  /\bcurl\b.*(?:\s(?:-d|--data(?:-\w+)?|-F|--form|-T|--upload-file|--json)\b|\s-X\s*(?:post|put|patch|delete)\b)/i,
  /\bwget\b.*--(?:post-data|post-file|method=(?:post|put))/i,
  /\b(?:iwr|irm|invoke-webrequest|invoke-restmethod)\b.*\s-(?:method\s+(?:post|put|patch|delete)\b|body\b|infile\b)/i,
  /\b(?:npm|pnpm|yarn)\s+publish\b|^(?:scp|sftp|ftp|nc|ncat|netcat|telnet)\b|\brsync\b.*\s\S+:/i,
];

/** Sends repository data or text to another system. Checked per segment. */
export function egressOperation(segmentText: string): boolean {
  return egressPatterns.some((pattern) => pattern.test(segmentText));
}

/** Warden CLI subcommands an agent must never run on the user's behalf. */
export function isWardenCommand(command: string): boolean {
  return /\bwarden(?:\.cmd|\.ps1)?\s+(?:approve|deny|allow|trust|untrust|vault|uninstall|disable|off|reset|init|config)\b/i.test(command);
}

/** `git config core.hooksPath` and friends turn ordinary git operations into code execution. */
export function isGitExecConfig(command: string): boolean {
  return /\bgit\b.*\bconfig\b.*\b(?:core\.hookspath|core\.fsmonitor|core\.sshcommand|alias\.\S+\s+["']?!)/i.test(command);
}

const gitModifyingSubcommands = new Set(["checkout", "restore", "apply", "mv", "rm", "am"]);

/** True when the segment changes the files named in its arguments. */
export function modifiesNamedFiles(segment: ShellSegment): boolean {
  return segment.modifiesArgs || (segment.verb === "git" && gitModifyingSubcommands.has(segment.args[0] ?? ""));
}
