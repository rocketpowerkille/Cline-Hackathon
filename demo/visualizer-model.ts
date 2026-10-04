import type { DemoResult } from "./run-demo.js";

export type Chapter = "unprotected" | "protected" | "recovery";
export interface ReplayEvent {
  id: number;
  chapter: Chapter;
  status: string;
  actor: string;
  action: string;
  risk: number;
  detail: string;
  node: string;
}
export interface VisualizerReplay {
  title: string;
  generatedAt: string;
  evidence: "executed-offline-demo";
  events: ReplayEvent[];
  summary: {
    unprotectedLeaks: number;
    protectedLeaks: number;
    mockRotations: number;
    oldFakeKeyRejected: boolean;
    instructionsRestored: boolean;
    scriptQuarantined: boolean;
    incidentClosed: boolean;
    scoringBackends: string[];
  };
}

function eventNode(status: string, actor: string, action: string): string {
  if (actor === "ATTACKER" || status === "LEAK") return "egress";
  if (actor === "RESPONDER") return "recovery";
  if (status === "SANDBOX" || status === "BLOCK") return "sandbox";
  if (action.includes("GitHub issue")) return "issue";
  if (action.includes("AGENTS.md")) return actor === "CLINE" ? "cline" : "files";
  if (action.includes("setup.sh")) return "files";
  if (actor === "CLINE") return "cline";
  if (actor === "WARDEN") return "sandbox";
  return "cursor";
}

/** Presentation data comes from the executed demo; no report bodies or secret values are served. */
export function buildVisualizerReplay(result: DemoResult, generatedAt = new Date().toISOString()): VisualizerReplay {
  let chapter: Chapter = "unprotected";
  let leaked = false;
  const events = result.trace.map((line, id): ReplayEvent => {
    const match = /^(\S+)\s+(\S+)\s+(.+?)\s{2,}(?:R(?:\[[^\]]+\])?=(\d+\.\d+)\s+)?(.+)$/.exec(line);
    if (!match) throw new Error("Unexpected demo trace format; refusing to invent replay evidence.");
    const status = match[1]!;
    const actor = match[2]!;
    const action = match[3]!;
    const risk = match[4]!;
    const detail = match[5]!;
    if (leaked && status === "FLAG" && actor === "CURSOR") chapter = "protected";
    if (status === "FIND" && actor === "RESPONDER") chapter = "recovery";
    if (status === "LEAK") leaked = true;
    return {
      id, chapter, status, actor, action, risk: risk === undefined ? 0 : Number(risk),
      detail: detail.replace(/npm_demo_FAKE_TOKEN_not_real_12345/g, "[fake credential]"),
      node: eventNode(status, actor, action),
    };
  });
  if (!events.some((event) => event.chapter === "protected" && event.status === "BLOCK") ||
      !events.some((event) => event.chapter === "recovery" && event.status === "CLOSED")) {
    throw new Error("Incomplete demo evidence; visualizer requires prevention and recovery.");
  }
  return {
    title: "Warden / OpenDots assessment", generatedAt, evidence: "executed-offline-demo", events,
    summary: {
      unprotectedLeaks: result.unprotectedReceipts.length,
      protectedLeaks: result.protectedReceipts.length,
      mockRotations: result.recovery.rotationCount,
      oldFakeKeyRejected: result.recovery.oldRejected,
      instructionsRestored: result.recovery.agentsRestored,
      scriptQuarantined: result.recovery.setupQuarantined,
      incidentClosed: result.recovery.closed,
      scoringBackends: [...result.riskBackends],
    },
  };
}