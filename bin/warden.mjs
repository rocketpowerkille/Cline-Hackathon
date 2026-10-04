#!/usr/bin/env node
import { existsSync } from "node:fs";

const compiled = new URL("../dist/cli/warden.js", import.meta.url);
const source = new URL("../src/cli/warden.ts", import.meta.url);
let runCli;
let register;
if (existsSync(source)) {
  try { ({ register } = await import("tsx/esm/api")); } catch { /* Production has no dev loader. */ }
}
if (register) {
  register();
  ({ runCli } = await import(source.href));
} else if (existsSync(compiled)) {
  ({ runCli } = await import(compiled.href));
} else {
  throw new Error("Warden needs npm run build or the source-checkout tsx dependency.");
}

try {
  process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`warden: ${message}\n`);
  process.exitCode = 1;
}