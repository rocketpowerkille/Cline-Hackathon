import os from "node:os";
import path from "node:path";

/** A target path canonicalized for matching: lowercase and slash-separated on every platform. */
export interface PathKey {
  /** Relative to the workspace when inside it, otherwise the absolute key. */
  key: string;
  inside: boolean;
  /** Absolute path with original casing, for filesystem reads. */
  resolved: string;
}

const homeAlias = /^(?:~|\$home|\$\{home\}|\$env:userprofile|%userprofile%)(?=\/|$)/i;

/**
 * Canonicalizes a target for matching. Handles `\` vs `/`, case, `..`, `~`/`$HOME`,
 * `\\?\` prefixes, NTFS `::$DATA` streams, and Windows' ignored trailing dots/spaces.
 */
export function pathKey(root: string, target: string, home = os.homedir()): PathKey | null {
  let value = target.trim().replace(/^["'`]+|["'`]+$/g, "");
  if (!value || /^[a-z][a-z0-9+.-]+:\/\//i.test(value)) return null; // URLs are not file paths
  value = value.replace(/\\/g, "/").replace(/^\/\/[?.]\//, "").replace(homeAlias, home.replace(/\\/g, "/"));
  const isAbsolute = /^[a-z]:\//i.test(value) || value.startsWith("/");
  const raw = isAbsolute ? value : `${root.replace(/\\/g, "/")}/${value}`;
  const absolute = clean(raw);
  const rootKey = clean(root.replace(/\\/g, "/"));
  const inside = absolute === rootKey || absolute.startsWith(`${rootKey}/`);
  return { key: inside ? absolute.slice(rootKey.length + 1) : absolute, inside, resolved: path.resolve(raw) };
}

function clean(value: string): string {
  const drive = /^[a-z]:/i.exec(value)?.[0] ?? "";
  const segments = path.posix
    .normalize(`/${value.slice(drive.length)}`)
    .split("/")
    .map((segment) => segment.replace(/::\$data$/i, ""))
    .map((segment) => (/^\.+$/.test(segment) ? segment : segment.replace(/[. ]+$/, "")))
    .filter((segment) => segment && segment !== ".");
  return `${drive}/${segments.join("/")}`.toLowerCase();
}

/** True when the path contains `parts` as whole segments (e.g. ".github/workflows"). */
export function hasSegments(key: string, parts: string): boolean {
  return `/${key}/`.includes(`/${parts}/`);
}

export function baseName(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1);
}

/** One simple command of a shell line. Deliberately light tokenizing, not a shell parser. */
export interface ShellSegment {
  text: string;
  verb: string;
  /** Command words after the verb, with quotes removed and flag values split out. */
  args: string[];
  /** Redirect targets and copy/move destinations. */
  writeTargets: string[];
  /** The verb (or an inline script) modifies the files it names. */
  modifiesArgs: boolean;
}

const copyVerbs = new Set(["cp", "mv", "copy", "move", "copy-item", "move-item", "cpi", "mi", "ln", "xcopy", "robocopy", "mklink", "install"]);
const modifyVerbs = new Set([
  "tee", "rm", "del", "erase", "rmdir", "rd", "unlink", "truncate", "touch", "dd", "shred",
  "set-content", "add-content", "out-file", "new-item", "remove-item", "rename-item", "clear-content",
  "ren", "sc", "ac", "ni", "ri", "chmod", "chown", "attrib", "icacls",
]);
const inlineWrite = /\bsed\b[^|;]*\s-i|\bperl\b[^|;]*\s-p?i|writefile|appendfile|write_text|createwritestream|\[io\.file\]::(?:write|append)|\bopen\([^)]*,\s*['"][wa]/i;
const prefixWords = new Set(["sudo", "env", "command", "exec", "nohup", "time", "&", "call", "start", "cmd", "/c", "-command", "powershell", "pwsh", "sh", "bash", "-c", "-lc"]);

/** Blanks commit/tag message text so prose like "fix rm -rf bug" cannot trigger command rules. */
export function stripMessages(command: string): string {
  return command.replace(/(\s(?:-[a-z]*m|--message|--body|--title)(?:=|\s+))("(?:[^"\\]|\\.)*"|'[^']*')/gi, "$1''");
}

export function shellSegments(command: string): ShellSegment[] {
  return stripMessages(command)
    .replace(/\d*>&\d/g, " ")
    .split(/\r?\n|;|&&|\|\||\||&(?!>)/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => {
      const writeTargets: string[] = [];
      const rest = text.replace(/(?:\d|&)?>>?\|?\s*("[^"]*"|'[^']*'|[^\s"'<>]+)/g, (_match, target: string) => {
        writeTargets.push(target);
        return " ";
      });
      const words = tokenize(rest);
      const start = words.findIndex((word) => !prefixWords.has(word.toLowerCase()) && !/^\w+=/.test(word));
      const commandWords = start < 0 ? [] : words.slice(start);
      const verb = (commandWords[0] ?? "").split(/[\\/]/).pop()!.toLowerCase().replace(/\.exe$/, "");
      const args = commandWords.slice(1).flatMap(splitFlagValue);
      const operands = args.filter((arg) => !arg.startsWith("-"));
      if (copyVerbs.has(verb) && operands.length > 1) writeTargets.push(operands.at(-1)!);
      return { text, verb, args, writeTargets, modifiesArgs: modifyVerbs.has(verb) || inlineWrite.test(text) };
    });
}

function tokenize(text: string): string[] {
  return [...text.matchAll(/"([^"]*)"|'([^']*)'|[^\s"']+/g)].map((match) => match[1] ?? match[2] ?? match[0]);
}

/**
 * `--file=x`, `of=x`, `-Path:x`, and curl's `@file` all name `x`.
 * Inline code (`node -e "fs.appendFileSync('AGENTS.md')"`) also yields its quoted strings.
 */
function splitFlagValue(word: string): string[] {
  const parts = /^(-{1,2}[\w-]+[=:]|\w+=)(.+)$/.exec(word);
  const values = parts ? [parts[1]!, parts[2]!] : [word];
  const embedded = /[(;]/.test(word) ? [...word.matchAll(/["'`]([^"'`\s]+)["'`]/g)].map((match) => match[1]!) : [];
  return [...values, ...embedded].map((value) => value.replace(/^@/, "").replace(/^[($`{]+|[)`};]+$/g, "")).filter(Boolean);
}
