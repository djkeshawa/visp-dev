/**
 * The temporary roots this laboratory owns, and the proof it owns them.
 *
 * A root is owned when its basename carries the prefix AND it holds a marker
 * file with exact content. Both conditions, because either alone is forgeable
 * by an unrelated directory that happens to be named similarly — and the only
 * thing standing between a cleanup and a caller's real tree is this check.
 */
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const OWNED_PREFIX = "visp-compatibility-lab-";
const OWNED_MARKER = ".visp-compatibility-lab-owned";
const OWNED_MARKER_CONTENT = "visp-dev compatibility laboratory owned root\n";

/** Whether `candidate` is `parent` or lies beneath it, lexically. */
export function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** The nearest ancestor of `candidate` that this laboratory owns, or null. */
export async function findOwnedRoot(candidate) {
  let current = path.resolve(candidate);
  while (true) {
    try {
      const marker = await readFile(path.join(current, OWNED_MARKER), "utf8");
      if (marker === OWNED_MARKER_CONTENT && path.basename(current).startsWith(OWNED_PREFIX)) return current;
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * A path that is strictly INSIDE an owned root. Equal to the root is refused:
 * every caller of this is about to create or destroy the path it names.
 */
export async function requireOwnedPath(candidate, label) {
  const absolute = path.resolve(candidate);
  const ownedRoot = await findOwnedRoot(absolute);
  if (!ownedRoot || !isWithin(ownedRoot, absolute) || absolute === ownedRoot) {
    throw new Error(`${label} must be inside a laboratory-owned temporary root`);
  }
  return { absolute, ownedRoot };
}

export async function createOwnedRoot({ baseDirectory = tmpdir() } = {}) {
  const base = await realpath(baseDirectory);
  const root = await mkdtemp(path.join(base, OWNED_PREFIX));
  await writeFile(path.join(root, OWNED_MARKER), OWNED_MARKER_CONTENT, { flag: "wx", mode: 0o600 });
  return { root };
}

export async function cleanupOwnedRoot({ root, keep = false }) {
  if (typeof root !== "string" || root.length === 0) throw new TypeError("root must be a non-empty string");
  const absolute = path.resolve(root);
  if (!path.basename(absolute).startsWith(OWNED_PREFIX)) throw new Error("Temporary root is not owned by the laboratory");
  let marker;
  try {
    marker = await readFile(path.join(absolute, OWNED_MARKER), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("Temporary root is not owned by the laboratory");
    throw error;
  }
  if (marker !== OWNED_MARKER_CONTENT) throw new Error("Temporary root is not owned by the laboratory");
  if (keep) return { kept: true };
  await rm(absolute, { recursive: true, force: false });
  return { kept: false };
}
