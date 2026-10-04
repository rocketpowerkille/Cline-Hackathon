import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Entry } from "@napi-rs/keyring";
import { migrate } from "../store/schema.js";
import { CANARY_PREFIX, isCanary, scanWardenCanaries } from "./canary.js";

const KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface SecretStore {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  delete(name: string): boolean;
}

export class KeyringSecretStore implements SecretStore {
  constructor(private readonly service: string) {}

  get(name: string): string | undefined {
    return new Entry(this.service, name).getPassword() ?? undefined;
  }

  set(name: string, value: string): void {
    new Entry(this.service, name).setPassword(value);
  }

  delete(name: string): boolean {
    return new Entry(this.service, name).deletePassword();
  }
}

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  get(name: string): string | undefined {
    return this.values.get(name);
  }

  set(name: string, value: string): void {
    this.values.set(name, value);
  }

  delete(name: string): boolean {
    return this.values.delete(name);
  }
}

export interface VaultEntry {
  name: string;
  placeholder: string;
  sourcePath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SeedResult {
  seeded: string[];
  skipped: string[];
}

export interface CanaryMatch {
  name: string | null;
  placeholder: string;
}

export interface RunTicket {
  id: string;
  sessionId: string;
  keyNames: string[];
}

export function keyringService(root: string): string {
  const identity = createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 16);
  return `warden:${identity}`;
}

export { scanWardenCanaries };

export class SecretVault {
  constructor(
    private readonly root: string,
    private readonly database: DatabaseSync,
    private readonly secrets: SecretStore,
  ) {
    // Vault tables live in the shared schema; this is a no-op when WardenStore already migrated.
    migrate(this.database);
  }

  add(name: string, value: string, sourcePath: string | null = null): VaultEntry {
    validateSecret(name, value);
    const existing = this.getEntry(name);
    const now = new Date().toISOString();
    const placeholder = existing?.placeholder ?? makePlaceholder(name);
    const previous = this.secrets.get(name);

    this.secrets.set(name, value);
    try {
      this.database.prepare(`
        INSERT INTO vault_entries (name, placeholder, source_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          source_path = excluded.source_path,
          updated_at = excluded.updated_at
      `).run(name, placeholder, sourcePath, now, now);
    } catch (error) {
      if (previous === undefined) this.secrets.delete(name);
      else this.secrets.set(name, previous);
      throw error;
    }

    return this.getEntry(name)!;
  }

  seedEnv(filename: string): SeedResult {
    const root = realpathSync(this.root);
    const absolute = realpathSync(path.resolve(root, filename));
    if (!isInside(root, absolute)) throw new Error("Environment file must be inside the protected repository");
    const original = readFileSync(absolute, "utf8");
    const parsed = parseEnv(original);
    const candidates = parsed.filter((line) => line.name && line.value && !isCanary(line.value));
    const skipped = parsed
      .filter((line) => line.name && (!line.value || isCanary(line.value)))
      .map((line) => line.name!);

    if (candidates.length === 0) return { seeded: [], skipped };

    const duplicates = candidates
      .map((line) => line.name!)
      .filter((name, index, names) => names.indexOf(name) !== index);
    if (duplicates.length > 0) throw new Error(`Duplicate environment key: ${duplicates[0]}`);

    const previous = new Map<string, string | undefined>();
    const replacements = new Map<string, string>();
    const sourcePath = path.relative(this.root, absolute) || path.basename(absolute);
    const temp = `${absolute}.warden-${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
    let replaced = false;

    this.database.exec("BEGIN");
    try {
      for (const line of candidates) {
        const name = line.name!;
        previous.set(name, this.secrets.get(name));
        const entry = this.add(name, line.value!, sourcePath);
        replacements.set(name, entry.placeholder);
      }

      const rewritten = parsed.map((line) => rewriteEnvLine(line, replacements)).join("");
      writeFileSync(temp, rewritten, { encoding: "utf8", flag: "wx" });
      renameSync(temp, absolute);
      replaced = true;
      this.database.exec("COMMIT");
      return { seeded: [...replacements.keys()], skipped };
    } catch (error) {
      if (this.database.isTransaction) this.database.exec("ROLLBACK");
      rmSync(temp, { force: true });
      if (replaced) writeFileSync(absolute, original, "utf8");
      for (const [name, value] of previous) {
        if (value === undefined) this.secrets.delete(name);
        else this.secrets.set(name, value);
      }
      throw error;
    }
  }

  list(): VaultEntry[] {
    return [...this.database.prepare(`
      SELECT name, placeholder, source_path, created_at, updated_at
      FROM vault_entries
      ORDER BY name
    `).iterate()].map(toVaultEntry);
  }

  scanCanaries(content: string): CanaryMatch[] {
    const known = new Map(this.list().map((entry) => [entry.placeholder, entry.name]));
    const found = new Map<string, CanaryMatch>();

    for (const placeholder of scanWardenCanaries(content)) {
      found.set(placeholder, { name: known.get(placeholder) ?? null, placeholder });
    }

    return [...found.values()];
  }

  grantEnvironment(sessionId: string, only: readonly string[] | null = null): NodeJS.ProcessEnv {
    if (!sessionId.trim()) throw new Error("sessionId is required");
    const selected = this.selectedEntries(only);
    const environment = this.environmentFor(selected);
    this.recordGrants(sessionId, selected.map((entry) => entry.name));
    return environment;
  }

  run(
    sessionId: string,
    command: string,
    args: readonly string[] = [],
    options: SpawnOptions = {},
    only: readonly string[] | null = null,
  ): ChildProcess {
    if (!sessionId.trim()) throw new Error("sessionId is required");
    const selected = this.selectedEntries(only);
    const injected = this.environmentFor(selected);
    const child = spawn(command, args, {
      ...options,
      env: { ...process.env, ...options.env, ...injected },
    });
    child.once("spawn", () => this.recordGrants(sessionId, selected.map((entry) => entry.name)));
    return child;
  }

  grantedNames(sessionId: string): string[] {
    return [...this.database.prepare(`
      SELECT DISTINCT name
      FROM vault_grants
      WHERE session_id = ?
      ORDER BY name
    `).iterate(sessionId)].map((row) => String(row.name));
  }

  issueRunTicket(
    sessionId: string,
    command: readonly string[],
    selection: readonly string[] | null,
    ttlMs = 30_000,
  ): string {
    if (!sessionId.trim()) throw new Error("sessionId is required");
    if (command.length === 0) throw new Error("run ticket command is required");
    const entries = this.selectedEntries(selection);
    const id = randomUUID();
    const now = new Date();
    this.database.prepare(`
      INSERT INTO vault_run_tickets (
        id, session_id, command_json, selection_json, key_names_json,
        expires_at, consumed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(
      id,
      sessionId,
      JSON.stringify(command),
      JSON.stringify(selection === null ? null : normalizeNames(selection)),
      JSON.stringify(entries.map((entry) => entry.name)),
      new Date(now.getTime() + ttlMs).toISOString(),
      now.toISOString(),
    );
    return id;
  }

  consumeRunTicket(command: readonly string[], selection: readonly string[] | null): RunTicket {
    const now = new Date().toISOString();
    const commandJson = JSON.stringify(command);
    const selectionValue = JSON.stringify(selection === null ? null : normalizeNames(selection));
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const rows = [...this.database.prepare(`
        SELECT id, session_id, key_names_json
        FROM vault_run_tickets
        WHERE command_json = ?
          AND selection_json = ?
          AND consumed_at IS NULL
          AND expires_at > ?
        ORDER BY created_at
        LIMIT 2
      `).iterate(commandJson, selectionValue, now)];
      if (rows.length === 0) throw new Error("No valid Warden run ticket for this command");
      if (rows.length > 1) throw new Error("Ambiguous Warden run ticket; retry the agent command");
      const row = rows[0]!;
      this.database.prepare("UPDATE vault_run_tickets SET consumed_at = ? WHERE id = ?").run(now, String(row.id));
      this.database.exec("COMMIT");
      return {
        id: String(row.id),
        sessionId: String(row.session_id),
        keyNames: JSON.parse(String(row.key_names_json)) as string[],
      };
    } catch (error) {
      if (this.database.isTransaction) this.database.exec("ROLLBACK");
      throw error;
    }
  }

  runWithTicket(
    command: string,
    args: readonly string[],
    selection: readonly string[] | null,
    launch: (environment: NodeJS.ProcessEnv) => ChildProcess,
  ): ChildProcess {
    const ticket = this.consumeRunTicket([command, ...args], selection);
    const selected = this.selectedEntries(ticket.keyNames);
    const child = launch(this.environmentFor(selected));
    child.once("spawn", () => this.recordGrants(ticket.sessionId, ticket.keyNames));
    return child;
  }

  private getEntry(name: string): VaultEntry | undefined {
    const row = this.database.prepare(`
      SELECT name, placeholder, source_path, created_at, updated_at
      FROM vault_entries
      WHERE name = ?
    `).get(name);
    return row ? toVaultEntry(row) : undefined;
  }

  private selectedEntries(only: readonly string[] | null): VaultEntry[] {
    const entries = this.list();
    if (only === null) return entries;
    const requested = normalizeNames(only);
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    return requested.map((name) => {
      const entry = byName.get(name);
      if (!entry) throw new Error(`Unknown vault key: ${name}`);
      return entry;
    });
  }

  private environmentFor(entries: readonly VaultEntry[]): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    for (const entry of entries) {
      const value = this.secrets.get(entry.name);
      if (value === undefined) throw new Error(`Secret is missing from the OS keychain: ${entry.name}`);
      environment[entry.name] = value;
    }
    return environment;
  }

  private recordGrants(sessionId: string, names: readonly string[]): void {
    const now = new Date().toISOString();
    this.database.exec("BEGIN");
    try {
      const insert = this.database.prepare(
        "INSERT INTO vault_grants (session_id, name, granted_at) VALUES (?, ?, ?)",
      );
      for (const name of names) insert.run(sessionId, name, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

interface ParsedEnvLine {
  raw: string;
  ending: string;
  prefix?: string;
  name?: string;
  value?: string;
  suffix?: string;
}

function parseEnv(content: string): ParsedEnvLine[] {
  return content.match(/.*(?:\r\n|\n|\r|$)/g)!
    .filter(Boolean)
    .map((rawWithEnding) => {
      const ending = rawWithEnding.match(/(?:\r\n|\n|\r)$/)?.[0] ?? "";
      const raw = ending ? rawWithEnding.slice(0, -ending.length) : rawWithEnding;
      const assignment = raw.match(/^(\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*)(.*)$/);
      if (!assignment) return { raw, ending };

      const parsedValue = parseEnvValue(assignment[3]!);
      return {
        raw,
        ending,
        prefix: assignment[1]!,
        name: assignment[2]!,
        value: parsedValue.value,
        suffix: parsedValue.suffix,
      };
    });
}

function parseEnvValue(raw: string): { value: string; suffix: string } {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("'") || trimmed.startsWith('"')) {
    const quote = trimmed[0]!;
    const end = trimmed.indexOf(quote, 1);
    if (end < 0) throw new Error("Unterminated quoted value in environment file");
    return { value: trimmed.slice(1, end), suffix: trimmed.slice(end + 1) };
  }

  const comment = raw.search(/\s+#/);
  const valuePart = comment < 0 ? raw : raw.slice(0, comment);
  return { value: valuePart.trim(), suffix: comment < 0 ? "" : raw.slice(comment) };
}

function rewriteEnvLine(line: ParsedEnvLine, replacements: Map<string, string>): string {
  if (!line.name || !line.prefix || !replacements.has(line.name)) return `${line.raw}${line.ending}`;
  return `${line.prefix}${replacements.get(line.name)}${line.suffix ?? ""}${line.ending}`;
}

function validateSecret(name: string, value: string): void {
  if (!KEY_NAME.test(name)) throw new Error(`Invalid environment key: ${name}`);
  if (!value) throw new Error(`Secret value is empty: ${name}`);
  if (isCanary(value)) throw new Error(`Refusing to store a Warden canary as a secret: ${name}`);
}

function makePlaceholder(name: string): string {
  return `${CANARY_PREFIX}${name}__${randomBytes(12).toString("hex")}__`;
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeNames(names: readonly string[]): string[] {
  return [...new Set(names)].sort();
}

function toVaultEntry(row: Record<string, unknown>): VaultEntry {
  return {
    name: String(row.name),
    placeholder: String(row.placeholder),
    sourcePath: row.source_path === null ? null : String(row.source_path),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
