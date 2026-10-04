/** Canary helpers shared by the vault and policy code. Kept free of keychain imports so hooks stay light. */
export const CANARY_PREFIX = "__WARDEN_CANARY__";

export function isCanary(value: string): boolean {
  return value.startsWith(CANARY_PREFIX);
}

/**
 * True when every assignment in an env file is empty or a Warden canary and at least one canary exists,
 * meaning the file holds no real secret values an agent could read.
 */
export function isFullyCanaried(content: string): boolean {
  let canaries = 0;
  for (const line of content.split(/\r\n|\n|\r/)) {
    const assignment = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/.exec(line);
    if (!assignment) continue;
    const value = assignment[1]!.trim().replace(/^(['"])(.*)\1.*$/, "$2").replace(/\s+#.*$/, "").trim();
    if (!value) continue;
    if (!isCanary(value)) return false;
    canaries += 1;
  }
  return canaries > 0;
}
