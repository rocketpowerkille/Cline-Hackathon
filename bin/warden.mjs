#!/usr/bin/env node
import { register } from "tsx/esm/api";

register();
const { runCli } = await import("../src/cli/warden.ts");

try {
  process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`warden: ${message}\n`);
  process.exitCode = 1;
}