import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathKey } from "../policy/targets.js";
import type { WardenStore } from "../store/database.js";

/** Explicit human-reviewed cleanup of a file, never a session. Refuse later edits and symlinks. */
export function reviewRestoredFile(store: WardenStore, root: string, target: string): string {
  const file = pathKey(root, target);
  if (!file?.inside || !file.key || file.key.startsWith(".warden/")) throw new Error("Expected a file inside the protected repository.");
  // Hold the writer lock while checking ledger provenance and disk contents. An out-of-band
  // filesystem writer remains outside Warden's control; an agent hook cannot race the ledger.
  store.database.exec("BEGIN IMMEDIATE");
  try {
    const taint = store.fileOrigin(file.key);
    if (!taint) throw new Error("File has no recorded taint.");
    const rootReal = realpathSync(root);
    let parent = path.dirname(file.resolved);
    while (!existsSync(parent) && path.dirname(parent) !== parent) parent = path.dirname(parent);
    const relativeParent = path.relative(rootReal, realpathSync(parent));
    if (relativeParent === ".." || relativeParent.startsWith(`..${path.sep}`) || path.isAbsolute(relativeParent)) throw new Error("File path leaves the workspace.");
    const present = existsSync(file.resolved);
    if (taint.existedBefore) {
      if (!present || !taint.snapshotPath) throw new Error("Original file or baseline is missing; keep taint and review manually.");
      const snapshotRoot = realpathSync(path.join(rootReal, ".warden", "snapshots"));
      if (lstatSync(file.resolved).isSymbolicLink() || !lstatSync(file.resolved).isFile()
        || lstatSync(taint.snapshotPath).isSymbolicLink() || !lstatSync(taint.snapshotPath).isFile()
        || path.dirname(realpathSync(taint.snapshotPath)) !== snapshotRoot
        || !realpathSync(file.resolved).startsWith(rootReal + path.sep)) throw new Error("Unsafe file or snapshot; taint retained.");
      const hash = (filename: string) => createHash("sha256").update(readFileSync(filename)).digest("hex");
      if (hash(file.resolved) !== hash(taint.snapshotPath)) throw new Error("File differs from the pre-taint baseline; taint retained.");
    } else if (present) {
      throw new Error("Attacker-created file still exists; quarantine it before clearing taint.");
    }
    const removed = store.database.prepare("DELETE FROM tainted_files WHERE path_key=? AND writer_session=?")
      .run(file.key, taint.writerSession);
    if (Number(removed.changes) !== 1) throw new Error("File taint changed during review.");
    store.database.exec("COMMIT");
  } catch (error) {
    if (store.database.isTransaction) store.database.exec("ROLLBACK");
    throw error;
  }
  return file.key;
}