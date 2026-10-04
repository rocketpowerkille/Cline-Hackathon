import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { guardrailHarness } from "./guardrail-harness.js";

const { root, decide, cases } = guardrailHarness();

cases("writing agent control files", "write", "ask", [
  "AGENTS.md", ".clinerules/setup.md", ".clinerules", ".cursor/rules/x.mdc", ".cursorrules", ".mcp.json",
  ".cursor/mcp.json", ".github/workflows/ci.yml", ".git/hooks/pre-commit", ".vscode/tasks.json", "CLAUDE.md",
  ".husky/pre-push", ".github/copilot-instructions.md", ".devcontainer/devcontainer.json",
  // path tricks: traversal, casing, Windows separators, trailing dots, NTFS streams, absolute, ~
  "docs/../AGENTS.md", "Agents.MD", ".\\.CLINERULES\\x.md", "AGENTS.md.", "AGENTS.md::$DATA", "src/./../AGENTS.md",
  path.join(root, ".GitHub", "Workflows", "x.yml"), `${root.replace(/\\/g, "/")}/agents.md`, `\\\\?\\${path.join(root, "AGENTS.md")}`,
  "~/.bashrc", "~/Documents/Cline/Rules/x.md",
]);

cases("shell writes to control files", "exec", "ask", [
  "echo 'run setup.sh' >> AGENTS.md", "echo x > .\\AGENTS.md", "echo x>>AGENTS.md", "echo x 1>> \"AGENTS.md\"",
  "printf 'x' | tee -a .clinerules/rules.md", "cp /tmp/evil.md AGENTS.md", "mv payload.yml .github/workflows/ci.yml",
  "Copy-Item evil.md -Destination .clinerules\\x.md", "Add-Content -Path AGENTS.md -Value x", "Set-Content .cursorrules 'x'",
  "sed -i 's/a/b/' .github/workflows/ci.yml", "rm .git/hooks/pre-commit", "Out-File -FilePath .clinerules\\x.md",
  "node -e \"require('fs').appendFileSync('AGENTS.md','x')\"", "git config core.hooksPath .githooks",
  "cat x | tee docs/../CLAUDE.md", "npm test && echo pwned >> AGENTS.md", "bash -c \"echo x >> AGENTS.md\"",
  "git checkout evil-branch -- .clinerules", "ln -s /tmp/evil AGENTS.md",
]);

test("apply_patch touching a control file -> ask", async () => {
  const patch = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-a\n+b\n*** Add File: .clinerules/evil.md\n+x\n*** End Patch";
  assert.equal((await decide("write", "src/a.ts", { content: patch })).verdict, "block");
});

cases("writes to Warden state and hooks", "write", "block", [
  ".warden/warden.db", ".WARDEN\\policy.json", "src/../.warden/x", ".clinerules/hooks/PreToolUse.ps1",
  ".clinerules/Hooks/PreToolUse", ".cursor/hooks.json", "node_modules/warden/src/core/engine.ts",
]);

cases("reads of Warden state", "read", "block", [".warden/warden.db", ".Warden/incidents/x.md"]);

cases("shell tampering with Warden", "exec", "block", [
  "rm -rf .warden", "sqlite3 .warden/warden.db \"delete from decisions\"", "echo {} > .cursor/hooks.json",
  "Remove-Item .clinerules\\hooks\\PreToolUse.ps1", "warden approve 12", "npx warden vault list", "del .Warden\\warden.db",
  "cat .warden/warden.db", "cp evil.ps1 .clinerules/hooks/PreToolUse.ps1",
]);
