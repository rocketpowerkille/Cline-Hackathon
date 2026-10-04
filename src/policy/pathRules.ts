import { baseName, hasSegments } from "./targets.js";

// Keys are lowercase and slash-separated; see pathKey().

/** Hook wiring that runs Warden itself; rewriting it would switch Warden off. */
export function isWardenHookPath(key: string): boolean {
  return (
    hasSegments(key, ".clinerules/hooks") ||
    hasSegments(key, "documents/cline/hooks") ||
    (hasSegments(key, ".cursor") && baseName(key) === "hooks.json")
  );
}

export function isWardenStatePath(key: string): boolean {
  return hasSegments(key, ".warden") || hasSegments(key, "node_modules/warden");
}

const controlNames = new Set([
  "agents.md", "claude.md", "gemini.md", "copilot-instructions.md", ".cursorrules", ".windsurfrules",
  ".clinerules", ".clineignore", ".cursorignore", ".mcp.json", "mcp.json", "cline_mcp_settings.json",
  ".gitlab-ci.yml", ".gitmodules", ".gitconfig", "authorized_keys",
  ".bashrc", ".zshrc", ".bash_profile", ".profile", "microsoft.powershell_profile.ps1",
]);
const controlDirs = [
  ".clinerules", ".cursor", ".claude", ".windsurf", ".roo", ".vscode", ".devcontainer", ".husky",
  ".github/workflows", ".github/actions", ".git/hooks", ".git/config", "documents/cline",
];

/** Files that steer agents, CI, editors, or git: writing them persists instructions or code execution. */
export function isControlPath(key: string): boolean {
  return controlNames.has(baseName(key)) || controlDirs.some((dir) => hasSegments(key, dir));
}

const safeEnvSuffix = /\.(?:example|sample|template|dist|defaults?)$/;
const keyFile = /^id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?$|\.(?:pem|key|p12|pfx|jks|keystore|ppk)$/;
const secretNames = new Set([
  ".npmrc", ".pypirc", ".netrc", "_netrc", ".git-credentials", ".pgpass", ".vault-token",
  "credentials.json", "secrets.json", "secrets.yml", "secrets.yaml",
]);

export type SecretKind = "env" | "secret";

/** Classifies files whose contents are credentials. Example/template env files are not secrets. */
export function secretKind(key: string): SecretKind | null {
  const name = baseName(key);
  if (/^\.env(?:rc)?(?:\..+)?$|\.env$/.test(name)) return safeEnvSuffix.test(name) ? null : "env";
  if (keyFile.test(name) || secretNames.has(name)) return "secret";
  if (hasSegments(key, ".ssh") && !/\.pub$|^known_hosts|^config$|^authorized_keys$/.test(name)) return "secret";
  if (hasSegments(key, ".aws") && name === "credentials") return "secret";
  if (/(?:^|\/)(?:\.docker\/config\.json|\.kube\/config|\.config\/gh\/hosts\.yml)$/.test(key)) return "secret";
  return null;
}
