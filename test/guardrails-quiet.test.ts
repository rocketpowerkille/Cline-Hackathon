import { guardrailHarness } from "./guardrail-harness.js";

// False positives make Warden useless: normal development work must never be flagged.
const { cases } = guardrailHarness();

cases("reading source and docs", "read", "allow", [
  "src/index.ts", "README.md", "package.json", ".env.example", ".env.sample", "docs/environment.md", "src/env.ts",
  ".gitignore", "src/keys.ts", "test/fixtures/agents.json", ".github/CODEOWNERS", "AGENTS.md", ".clinerules/style.md",
  "src/warden-client.ts", "~/.ssh/id_rsa.pub", "~/.ssh/known_hosts",
]);

cases("writing source files", "write", "allow", [
  "src/index.ts", "test/app.test.ts", "README.md", "docs/AGENTS-guide.md", "src/cursor.ts", "package.json",
  ".env.example", "src/hooks/useAuth.ts", ".github/ISSUE_TEMPLATE/bug.md", "src/.cursor-helpers.ts",
]);

cases("everyday shell commands", "exec", "allow", [
  "npm test", "npm.cmd run typecheck", "npm install", "npm ci", "npx tsc --noEmit", "node --test",
  "git status", "git diff", "git add -A", "git log --oneline -5", "git checkout -b feature/x", "git checkout main",
  "git commit -m \"fix rm -rf handling; drop table guard\"", "git commit -m 'echo x >> AGENTS.md'",
  "git pull --rebase", "git push", "git push origin main", "git push -u origin feature/x", "git fetch --all",
  "git stash", "git merge main", "git rebase main",
  "ls -la", "dir", "Get-ChildItem src", "cat src/index.ts", "type README.md", "Get-Content README.md", "cat AGENTS.md",
  "echo hello > out.txt", "node scripts/build.js >> build.log 2>&1", "npm test 2>&1 | tee test.log",
  "mkdir -p src/utils", "cp src/a.ts src/b.ts", "mv src/old.ts src/new.ts",
  "rm -rf node_modules", "rm -rf dist build coverage", "Remove-Item -Recurse -Force .\\dist", "rm src/old.ts",
  "rm -rf node_modules && npm ci", "rd /s /q node_modules",
  "curl https://example.com/api/status", "curl -sSL https://registry.npmjs.org/tsx -o tsx.json",
  "wget https://example.com/file.tar.gz", "grep -r TODO src", "rg password src", "python -m pytest", "docker ps",
  "gh pr view 12", "gh issue list", "gh pr checks", "cat .env.example", "echo 'see AGENTS.md for rules'",
  "npm run lint -- --fix", "npx prettier --write src", "tsx src/hooks/main.ts cline < fixture.json",
  "git diff > changes.patch", "Select-String -Path src\\*.ts -Pattern TODO",
  "git commit -am \"handle DROP TABLE and git push --force docs\"", "git commit --message='rm -rf cleanup'",
  "echo \"never run DROP TABLE users\"", "Write-Host 'git reset --hard is dangerous'",
  "cat src/hooks/run.ts", "Get-Content .\\src\\core\\engine.ts", "git add .clinerules/style.md AGENTS.md",
  "warden run -- npm test", "warden run --only NPM_TOKEN -- npm publish --dry-run",
]);

cases("routine MCP tools", "mcp", "allow", ["github/get_issue", "github/add_issue_comment", "filesystem/read_file"]);
