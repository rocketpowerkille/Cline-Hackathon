import path from "node:path";

export interface WardenRunInvocation {
  command: string;
  args: string[];
  only: string[] | null;
}

export function parseWardenRunArgv(argv: readonly string[]): WardenRunInvocation {
  const separator = argv.indexOf("--");
  if (separator < 0 || separator === argv.length - 1) {
    throw new Error("Usage: warden run [--only NAME[,NAME...]] -- <command> [args...]");
  }

  const options = argv.slice(0, separator);
  const command = argv[separator + 1]!;
  const args = argv.slice(separator + 2);
  const only: string[] = [];

  for (let index = 0; index < options.length; index += 1) {
    const option = options[index]!;
    if (option === "--only") {
      const value = options[++index];
      if (!value) throw new Error("--only requires one or more comma-separated key names");
      only.push(...splitNames(value));
    } else if (option.startsWith("--only=")) {
      only.push(...splitNames(option.slice("--only=".length)));
    } else {
      throw new Error(`Unknown warden run option: ${option}`);
    }
  }

  return { command, args, only: only.length > 0 ? normalizeNames(only) : null };
}

export function parseWardenRunCommand(commandLine: string): WardenRunInvocation | null {
  const words = shellWords(commandLine);
  if (words.length < 3) return null;
  const executable = path.basename(words[0]!).toLowerCase();
  if (!["warden", "warden.cmd", "warden.exe"].includes(executable) || words[1] !== "run") return null;
  return parseWardenRunArgv(words.slice(2));
}

export function invocationCommand(invocation: WardenRunInvocation): string[] {
  return [invocation.command, ...invocation.args];
}

export function selectionJson(only: readonly string[] | null): string {
  return JSON.stringify(only === null ? null : normalizeNames(only));
}

function splitNames(value: string): string[] {
  const names = value.split(",").map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) throw new Error("--only requires one or more key names");
  return names;
}

function normalizeNames(names: readonly string[]): string[] {
  return [...new Set(names)].sort();
}

function shellWords(input: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote = "";
  let started = false;

  for (const character of input.trim()) {
    if (quote) {
      if (character === quote) quote = "";
      else word += character;
      started = true;
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) {
        words.push(word);
        word = "";
        started = false;
      }
    } else {
      word += character;
      started = true;
    }
  }

  if (quote) throw new Error("Unterminated quote in warden run command");
  if (started) words.push(word);
  return words;
}