import { buildVisualizerReplay } from "./visualizer-model.js";
import { startVisualizer } from "./visualizer-server.js";

// Set before importing the demo: this presentation never calls a cloud scoring provider.
process.env.WARDEN_RISK_OFFLINE = "1";
process.env.WARDEN_ENABLE_OLLAMA = "0";
const rawPort = process.argv[2] ?? "8766";
if (!/^\d+$/.test(rawPort) || Number(rawPort) > 65535) throw new Error("Port must be 0–65535.");
console.log("Preparing verified offline replay in temporary repositories. OpenDots is not accessed.");
const { runDemo } = await import("./run-demo.js");
const result = await runDemo({ color: false, cleanup: true, forceNodeFallback: true, print: () => {} });
const viewer = await startVisualizer(buildVisualizerReplay(result), Number(rawPort));
console.log(`\nWarden Demo Studio: ${viewer.url}`);
console.log(`All capabilities: ${viewer.url}capabilities`);
console.log("Space: play/pause | arrows: step | R: restart | C: recording mode | F: fullscreen");
console.log("Verified replay, fake credentials, mock rotation. No live OpenDots compromise is claimed.");
let closing = false;
const stop = () => {
  if (closing) return;
  closing = true;
  void viewer.close().then(() => { process.exitCode = 0; });
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);