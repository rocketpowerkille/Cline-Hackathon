import { decodeHookInput, HookInputError } from "../adapters/common.js";
import { hookHosts, isHookHost, runHook } from "./run.js";

// Usage: tsx src/hooks/main.ts <cline|cursor> [event] < hook-input.json
const [host, event] = process.argv.slice(2);

if (!isHookHost(host)) {
  process.stderr.write(`warden hook: expected host ${hookHosts.join(" or ")}\n`);
  process.exit(1);
}

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));

const result = runHook({
  host,
  event,
  input: decodeHookInput(Buffer.concat(chunks)),
  cwd: process.cwd(),
  env: process.env,
  onError: (error) => {
    // Only log messages known to be content-free; other errors may echo secrets from the input.
    const detail = error instanceof HookInputError ? error.message : error instanceof Error ? error.name : "Error";
    process.stderr.write(`warden hook: failed open (${detail})\n`);
  },
});

process.stdout.write(`${result.stdout}\n`);
process.exitCode = result.exitCode;
