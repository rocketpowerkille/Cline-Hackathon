import path from "node:path";

export interface WorkspacePath {
  absolute: string;
  relative: string;
  match: string;
}

export function workspacePath(root: string, target: string): WorkspacePath {
  const absolute = path.resolve(root, target);
  const relative = path.relative(path.resolve(root), absolute);
  const normalized = relative.split(path.sep).join("/");

  return {
    absolute,
    relative,
    match: process.platform === "win32" ? normalized.toLowerCase() : normalized,
  };
}

export function wardenStatePath(root: string, ...parts: string[]): string {
  return path.join(root, ".warden", ...parts);
}