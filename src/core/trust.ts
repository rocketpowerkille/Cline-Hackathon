import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import type { AgentAction } from "./types.js";
import { pathKey, shellSegments } from "../policy/targets.js";
import type { WardenStore } from "../store/database.js";

// Detection is deliberately separate from taint: even an innocuous external result is untrusted.
export function looksLikeInjection(output: string): boolean {
  return /(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+(?:instructions|rules|prompts)|(?:system|developer)\s+(?:message|instruction)\s*:|(?:run|execute|source)\s+(?:this\s+)?(?:command|script)|(?:exfiltrat|steal|send)\s+(?:the\s+)?(?:token|secret|credentials)/i.test(output);
}

export function externalResult(action: AgentAction): boolean {
  if (!action.post || action.success === false) return false;
  if (action.kind === "net" || action.kind === "mcp") return true;
  if (action.kind !== "exec") return false;
  // A shell can return attacker-controlled text through curl, gh, git, and arbitrary programs.
  return action.observedOutput !== undefined && action.observedOutput.length > 0;
}

export function readKeys(action: AgentAction, root: string): string[] {
  const targets = action.kind === "read" ? [action.target] : action.kind === "exec"
    ? shellSegments(action.target || action.content).flatMap((segment) => segment.args) : [];
  if (action.kind === "read" && action.post && action.observedOutput) {
    // Search/list output may quote tainted files while the tool target is only a directory.
    // Extract bounded path-shaped tokens, then match only keys already in the taint ledger.
    for (const match of action.observedOutput.slice(0, 64 * 1024).matchAll(/(?:^|[\s"'`(])(?:\.\/)?([\w.@ -]+(?:[\\/][\w.@ -]+)*\.(?:md|txt|sh|js|ts|json|yml|yaml|py|ps1|cmd|bat|toml|env))(?=[:\s"'`),]|$)/gim)) {
      targets.push(match[1]!);
    }
  }
  return targets.map((target) => pathKey(root, target)).filter((key) => key?.inside && key.key).map((key) => key!.key);
}

export function writeKeys(action: AgentAction, root: string): { key: string; resolved: string }[] {
  if (action.kind !== "write" && action.kind !== "exec") return [];
  const targets = action.kind === "exec" ? shellSegments(action.target || action.content).flatMap((segment) => segment.writeTargets)
    : [action.target, ...[...action.content.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)]
    .map((match) => (match[1] ?? match[2])!.trim())];
  const files = targets.map((target) => pathKey(root, target)).filter((file) => file?.inside && file.key && !/[*$?{}]/.test(file.key));
  return [...new Map(files.map((file) => [file!.key, { key: file!.key, resolved: file!.resolved }])).values()];
}

/** Save the first pre-taint version; subsequent tainted writes must not overwrite the baseline. */
export function snapshotTaintedWrite(store: WardenStore, root: string, action: AgentAction, reason: string): void {
  for (const file of writeKeys(action, root)) {
    if (store.fileOrigin(file.key)) continue;
    const existed = existsSync(file.resolved);
    let snapshot: string | null = null;
    {
      // Refuse to snapshot symlinks or files outside the real workspace via symlinked parents.
      const realRoot = realpathSync(root);
      let parent = path.dirname(file.resolved);
      while (!existsSync(parent) && path.dirname(parent) !== parent) parent = path.dirname(parent);
      const actualParent = realpathSync(parent);
      if (!actualParent.startsWith(realRoot + path.sep) && actualParent !== realRoot) continue;
      if (existed) {
        if (!realpathSync(file.resolved).startsWith(realRoot + path.sep)) continue;
        if (!lstatSync(file.resolved).isFile()) continue;
        const dir = path.join(root, ".warden", "snapshots");
        mkdirSync(dir, { recursive: true });
        snapshot = path.join(dir, randomUUID());
        copyFileSync(file.resolved, snapshot);
      }
    }
    store.markFile(file.key, action.sessionId, reason, snapshot, existed);
  }
}