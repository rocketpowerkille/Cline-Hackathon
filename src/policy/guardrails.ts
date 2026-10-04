import type { AgentAction, Verdict } from "../core/types.js";
import {
  buildArtifacts,
  destructiveOperation,
  egressOperation,
  forcedDeleteTargets,
  isGitExecConfig,
  isRemoteExec,
  isWardenCommand,
  modifiesNamedFiles,
} from "./commandRules.js";
import { isControlPath, isWardenHookPath, isWardenStatePath, secretKind } from "./pathRules.js";
import { baseName, pathKey, shellSegments, type PathKey } from "./targets.js";

export interface Finding {
  verdict: Exclude<Verdict, "allow">;
  label: string;
  reason: string;
}

export interface PolicyContext {
  workspaceRoot: string;
  /** True when the file is a vault-seeded env file whose values are all canaries right now. */
  isCanariedEnv(file: PathKey): boolean;
}

export type GuardrailStage = (action: AgentAction, context: PolicyContext) => Finding[] | Promise<Finding[]>;

const tamper = (what: string): Finding => ({ verdict: "block", label: "warden-tamper", reason: `Agents may not modify Warden (${what}).` });

function readFindings(file: PathKey, context: PolicyContext): Finding[] {
  if (isWardenStatePath(file.key)) return [tamper(file.key)];
  const secret = secretKind(file.key);
  if (!secret || (secret === "env" && context.isCanariedEnv(file))) return [];
  return [{ verdict: "ask", label: "secret-read", reason: `Reading secret file ${baseName(file.key)} needs approval.` }];
}

function writeFindings(file: PathKey): Finding[] {
  if (isWardenStatePath(file.key) || isWardenHookPath(file.key)) return [tamper(file.key)];
  if (isControlPath(file.key)) {
    return [{ verdict: "ask", label: "control-file", reason: `Changing agent/CI control file ${file.key} needs approval.` }];
  }
  return [];
}

/** Every file a write-tool action touches, including all files named in an apply_patch body. */
function writeTargets(action: AgentAction): string[] {
  const patched = [...action.content.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)];
  return [action.target, ...patched.map((match) => (match[1] ?? match[2])!.trim())];
}

function isArtifactDelete(targets: string[], root: string): boolean {
  return targets.length > 0 && targets.every((target) => {
    const file = pathKey(root, target);
    return !!file && file.inside && file.key !== "" && buildArtifacts.has(baseName(file.key).replace(/[*/]+$/, ""));
  });
}

/** Commands that only print their arguments; their text is prose, not an operation. */
const printVerbs = new Set(["echo", "printf", "write-host", "write-output"]);

function execFindings(action: AgentAction, context: PolicyContext): Finding[] {
  const command = action.target || action.content;
  const root = context.workspaceRoot;
  const untrusted = action.untrustedInput;
  const findings: Finding[] = [];

  if (isWardenCommand(command)) findings.push(tamper("warden CLI"));
  if (isRemoteExec(command)) {
    findings.push(
      untrusted
        ? { verdict: "block", label: "remote-exec", reason: "Untrusted session tried to pipe a download into a shell." }
        : { verdict: "sandbox", label: "remote-exec", reason: "Downloaded script piped into a shell runs in the sandbox first." },
    );
  }
  if (isGitExecConfig(command)) {
    findings.push({ verdict: "ask", label: "control-file", reason: "Changing git hook/exec configuration needs approval." });
  }

  for (const segment of shellSegments(command)) {
    const modifies = modifiesNamedFiles(segment);
    for (const target of segment.writeTargets) {
      const file = pathKey(root, target);
      if (file) findings.push(...writeFindings(file));
    }
    for (const arg of segment.args) {
      const file = pathKey(root, arg);
      if (!file) continue;
      findings.push(...readFindings(file, context));
      if (modifies) findings.push(...writeFindings(file));
    }

    const deleted = forcedDeleteTargets(segment);
    const printsOnly = printVerbs.has(segment.verb) && segment.writeTargets.length === 0;
    const destructive = deleted && !isArtifactDelete(deleted, root)
      ? "recursive force delete"
      : printsOnly ? null : destructiveOperation(segment.text);
    if (destructive) findings.push({ verdict: "ask", label: "destructive", reason: `Destructive command (${destructive}) needs approval.` });

    if (untrusted && egressOperation(segment.text)) {
      findings.push({ verdict: "sandbox", label: "egress", reason: "Untrusted session tried to send data out; sandboxed." });
    }
  }

  if (untrusted) findings.push({ verdict: "sandbox", label: "untrusted-exec", reason: "Commands from an untrusted session run in the sandbox." });
  return findings;
}

const outboundTool = /(?:^|[_\-/.])(?:comment|create|post|send|push|publish|upload|update|write|edit|merge|reply|message|commit)/i;

/** Fixed, deterministic rules. No model calls; same input always yields the same findings. */
export const guardrails: GuardrailStage = (action, context) => {
  const root = context.workspaceRoot;
  switch (action.kind) {
    case "read": {
      const file = pathKey(root, action.target);
      return file ? readFindings(file, context) : [];
    }
    case "write":
      return writeTargets(action).flatMap((target) => {
        const file = pathKey(root, target);
        return file ? writeFindings(file) : [];
      });
    case "exec":
      return execFindings(action, context);
    case "mcp":
      // MCP calls cannot be shadow-run, so outbound tools from untrusted sessions are blocked outright.
      return action.untrustedInput && outboundTool.test(`${action.tool} ${action.target}`)
        ? [{ verdict: "block", label: "egress", reason: "Untrusted session tried to post data through an external tool." }]
        : [];
    default:
      return [];
  }
};
