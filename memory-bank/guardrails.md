# Guardrails (Segment 02)

Fixed, deterministic rules with no model calls. Code: `src/policy/{targets,pathRules,commandRules,guardrails}.ts`.
The stage returns `Finding[]` (`verdict`, `label`, `reason`); `Engine.combine` picks the strictest: block > ask > sandbox > allow.

## Rules

| Label | Trigger | Verdict |
| --- | --- | --- |
| `warden-tamper` | Reading or writing `.warden/`, `node_modules/warden`; writing `.clinerules/hooks/`, `~/Documents/Cline/Hooks/`, `.cursor/hooks.json`; `warden approve/vault/trust/...` CLI | block |
| `control-file` | Writing AGENTS.md, CLAUDE.md, .clinerules, .cursor/, .cursorrules, MCP configs, .github/workflows and actions, .git/hooks, .git/config, .vscode, .devcontainer, .husky, shell profiles; `git config core.hooksPath` and similar | ask |
| `secret-read` | Reading .env* (but not .example/.sample/.template), SSH private keys, *.pem/*.key, .npmrc, .netrc, .git-credentials, ~/.aws/credentials, and similar | ask |
| `secret-read` exemption | `.env` recorded in `vault_entries.source_path` **and** whose values are all canaries or empty at read time | allow |
| `destructive` | `rm -rf` or Remove-Item -Recurse -Force on non-artifacts, force/delete push, reset --hard, clean -f, branch -D, DROP/TRUNCATE, DELETE without WHERE, find -delete, disk wipes, unpublish, terraform destroy, and similar | ask |
| `remote-exec` | Download piped into an interpreter (`curl\|bash`, `bash <(curl)`, `iwr\|iex`, `DownloadString`) | sandbox; block if untrusted |
| `untrusted-exec` | Any exec when `untrustedInput` | sandbox |
| `egress` | Untrusted exec: git push, gh comment/create/..., curl/iwr POST/data, publish, scp/nc | sandbox (plus label) |
| `egress` | Untrusted MCP tool whose name looks outbound (comment/create/post/send/push/...) | block (MCP cannot be shadow-run) |

## Shell coverage (light tokenizer, not a parser)

- Lines are split on newlines, `;`, `&&`, `||`, `|`, and `&`. Redirect targets (`>`, `>>`, `2>`, `>|`) and copy/move/link destinations count as writes.
- Arguments of modifying verbs (rm, tee, sed -i, Set/Add-Content, Out-File, git checkout/restore, ...) count as writes. Every path-like argument is also checked as a read.
- `--flag=x`, `-Path:x`, `of=x`, and curl `@file` are split out. Quoted strings inside inline code (`node -e`, `python -c`) are extracted.
- Commit, PR, and issue message text (`-m`, `--message`, `--body`, `--title`) is blanked first, and echo/printf/Write-Host text never triggers destructive rules.
- Known gaps: variables and indirection (`f=AGENTS.md; echo x >> $f`), base64 or encoded commands, and scripts that write files internally. Trust (03), risk (04), and the sandbox (06) cover these.

## Path canonicalization (`pathKey`)

Handles `\`/`/`, case-folding on all platforms, `..`, `~`/`$HOME`/`$env:USERPROFILE`/`%USERPROFILE%`, `\\?\` prefixes, NTFS `::$DATA`, and Windows-ignored trailing dots/spaces. Absolute paths inside the workspace become relative keys. URLs are ignored.

## Quiet by design (tested in `test/guardrails-quiet.test.ts`)

Source reads and writes, reading AGENTS.md/.clinerules, `npm test/ci/install`, normal git including plain `git push` when trusted, `rm -rf node_modules/dist/build/coverage`, and plain curl/wget downloads all allow.
