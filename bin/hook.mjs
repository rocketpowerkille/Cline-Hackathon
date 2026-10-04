#!/usr/bin/env node
import { existsSync } from "node:fs";

const compiled = new URL("../dist/hooks/main.js", import.meta.url);
const source = new URL("../src/hooks/main.ts", import.meta.url);
let register;
if (existsSync(source)) {
  try { ({ register } = await import("tsx/esm/api")); } catch { /* Production has no dev loader. */ }
}
if (register) {
  register();
  await import(source.href);
} else if (existsSync(compiled)) {
  await import(compiled.href);
} else {
  throw new Error("Warden needs npm run build or the source-checkout tsx dependency.");
}