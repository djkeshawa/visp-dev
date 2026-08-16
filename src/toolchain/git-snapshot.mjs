/**
 * Materialising a committed tree, and refusing to pretend when it cannot.
 *
 * Every blob is re-hashed against its own object ID and its Git mode is
 * restored and then verified. The snapshot is the only thing standing between
 * "we packed the pinned commit" and "we packed whatever was in the worktree".
 */
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  findExecutable,
  runProcess,
  stableEnvironment,
  trimLine,
} from "./process.mjs";
import { requireOwnedPath } from "./owned-root.mjs";

const MAX_GIT_TREE_BYTES = 16 * 1024 * 1024;
const MAX_GIT_BLOB_BYTES = 64 * 1024 * 1024;

/**
 * Git with every ambient configuration source neutralised: no system or global
 * config, no hooks, no attributes file, no CRLF rewriting. Any one of those
 * left on would let the machine's settings change the bytes of a snapshot.
 */
export async function runGit(args, options = {}) {
  const gitExecutable = await findExecutable("git");
  if (!gitExecutable) throw new Error("Git executable unavailable");
  const environment = {
    ...stableEnvironment([gitExecutable]),
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "0",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
  };
  return runProcess(
    gitExecutable,
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.attributesFile=/dev/null",
      "-c",
      "core.safecrlf=true",
      ...args,
    ],
    { ...options, env: environment },
  );
}

async function runGitChecked(args, options, label) {
  const result = await runGit(args, options);
  if (result.spawnError || result.timedOut || result.exitCode !== 0) {
    const error = new Error(`${label} failed`);
    error.code = "GIT_PROCESS_FAILED";
    Object.defineProperty(error, "observation", { enumerable: false, value: result });
    throw error;
  }
  return result;
}

export async function resolveCommit({ repositoryRoot, commit }) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) {
    throw new TypeError("repositoryRoot must be an explicit non-empty path");
  }
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new TypeError("commit must be a full 40-character lowercase hexadecimal ID");
  }
  let root;
  try {
    root = await realpath(repositoryRoot);
  } catch {
    throw new Error("repositoryRoot must identify an existing Git repository root");
  }
  const topLevelResult = await runGit(["-C", root, "rev-parse", "--show-toplevel"]);
  if (topLevelResult.exitCode !== 0 || topLevelResult.spawnError) {
    throw new Error("repositoryRoot must identify an existing Git repository root");
  }
  const topLevel = await realpath(trimLine(topLevelResult.stdout));
  if (topLevel !== root) throw new Error("repositoryRoot must be the exact Git repository root");

  const typeResult = await runGit(["-C", root, "cat-file", "-t", commit]);
  if (typeResult.exitCode !== 0 || trimLine(typeResult.stdout) !== "commit") {
    throw new Error("Revision must identify an existing commit object");
  }
  const commitResult = await runGitChecked(["-C", root, "rev-parse", `${commit}^{commit}`], {}, "Commit resolution");
  const treeResult = await runGitChecked(["-C", root, "show", "-s", "--format=%T", commit], {}, "Tree resolution");
  const exactCommit = trimLine(commitResult.stdout);
  const tree = trimLine(treeResult.stdout);
  if (exactCommit !== commit || !/^[0-9a-f]{40}$/.test(tree)) {
    throw new Error("Git returned an invalid commit or tree identity");
  }
  return { commit: exactCommit, tree };
}

/**
 * Whether this platform can reproduce a committed tree faithfully.
 *
 * The snapshot restores each blob's Git mode and verifies it was applied, so a
 * 100755 file is executable in the snapshot exactly as it is in the commit.
 * Windows has no POSIX mode bits: `chmod` is a no-op there and the verification
 * cannot pass. That is a real limit on where this evidence can be produced, not
 * a defect to code around — relaxing the check would weaken every snapshot on
 * every platform to make one platform quiet.
 */
export function snapshotFidelityAvailable() {
  return process.platform !== "win32";
}

export async function snapshotCommit({ repositoryRoot, commit, destination }) {
  const { absolute } = await requireOwnedPath(destination, "destination");
  const resolved = await resolveCommit({ repositoryRoot, commit });
  const objectRepository = `${absolute}.git-objects`;
  try {
    await runGitChecked(
      ["clone", "--quiet", "--bare", "--no-hardlinks", await realpath(repositoryRoot), objectRepository],
      {},
      "Disposable object clone",
    );
    const treeResult = await runGitChecked(
      ["--git-dir", objectRepository, "ls-tree", "-rz", "--full-tree", resolved.commit],
      { maxOutputBytes: MAX_GIT_TREE_BYTES },
      "Committed tree inventory",
    );
    if (treeResult.stdout.truncated || treeResult.stderr.truncated) {
      throw new Error("Committed tree inventory exceeded bounded capture");
    }
    await mkdir(absolute);
    const records = treeResult.stdout.buffer.subarray(0, treeResult.stdout.bytes).toString("utf8").split("\0").filter(Boolean);
    const seenPaths = new Set();
    for (const record of records) {
      const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/u.exec(record);
      if (!match) throw new Error("Committed tree contains an unsupported entry");
      const [, mode, objectId, relativePath] = match;
      if (relativePath.includes("�")
        || relativePath.includes("\\")
        || path.posix.isAbsolute(relativePath)
        || path.posix.normalize(relativePath) !== relativePath
        || relativePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
        || seenPaths.has(relativePath)) {
        throw new Error("Committed tree contains an unsafe path");
      }
      seenPaths.add(relativePath);
      const sizeResult = await runGitChecked(
        ["--git-dir", objectRepository, "cat-file", "-s", objectId],
        {},
        "Committed blob size",
      );
      const byteSize = Number(trimLine(sizeResult.stdout));
      if (!Number.isSafeInteger(byteSize) || byteSize < 0 || byteSize > MAX_GIT_BLOB_BYTES) {
        throw new Error("Committed blob exceeds the supported snapshot bound");
      }
      const blobResult = await runGitChecked(
        ["--git-dir", objectRepository, "cat-file", "blob", objectId],
        { maxOutputBytes: byteSize },
        "Committed blob read",
      );
      if (blobResult.stdout.truncated || blobResult.stdout.bytes !== byteSize || blobResult.stderr.bytes !== 0) {
        throw new Error("Committed blob read was incomplete");
      }
      const bytes = blobResult.stdout.buffer;
      const computedObjectId = createHash("sha1")
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex");
      if (computedObjectId !== objectId) throw new Error("Committed blob identity mismatch");
      const outputPath = path.join(absolute, ...relativePath.split("/"));
      await mkdir(path.dirname(outputPath), { recursive: true });
      const expectedMode = mode === "100755" ? 0o755 : 0o644;
      await writeFile(outputPath, bytes, { flag: "wx", mode: expectedMode });
      await chmod(outputPath, expectedMode);
      const materialized = await lstat(outputPath);
      if (!materialized.isFile() || (materialized.mode & 0o777) !== expectedMode) {
        throw new Error("Committed blob mode could not be materialized faithfully");
      }
    }
  } catch (error) {
    await rm(absolute, { recursive: true, force: true });
    await rm(objectRepository, { recursive: true, force: true });
    throw error;
  }
  return resolved;
}
