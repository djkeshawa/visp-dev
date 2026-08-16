/**
 * The environment an npm-family tool runs in, and the offline stores it reads.
 *
 * Every knob that would otherwise reach the network or the user's home
 * directory is pinned here: an empty user and global npmrc written into the
 * owned root, `--offline`, and no audit, fund or update-notifier traffic. A run
 * that could reach the registry would be measuring the registry.
 *
 * Split out from `npm-pack.mjs` and `npm-install.mjs` because both need it and
 * they already depend on each other in one direction.
 */
import { cp, mkdir, readFile, readdir, readlink, lstat, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalStringify, sha256Hex } from "../platform/canonical-json.mjs";
import { compareText, stableEnvironment } from "./process.mjs";
import { isWithin } from "./owned-root.mjs";

export async function npmEnvironment({ executables, configurationDirectory, cacheDirectory, ignoreScripts }) {
  await mkdir(configurationDirectory, { recursive: true });
  const userConfig = path.join(configurationDirectory, "user.npmrc");
  const globalConfig = path.join(configurationDirectory, "global.npmrc");
  await writeFile(userConfig, "", { flag: "wx" });
  await writeFile(globalConfig, "", { flag: "wx" });
  return {
    ...stableEnvironment(executables),
    npm_config_audit: "false",
    npm_config_cache: cacheDirectory,
    npm_config_fund: "false",
    npm_config_globalconfig: globalConfig,
    npm_config_ignore_scripts: ignoreScripts ? "true" : "false",
    npm_config_offline: "true",
    npm_config_update_notifier: "false",
    npm_config_userconfig: userConfig,
  };
}

/**
 * A digest over every byte, mode and symlink target under `root`.
 *
 * An escaping symbolic link is refused rather than recorded: a cache that could
 * point outside itself would let a copy pull in content the inventory never
 * covered, and the inventory is the only evidence the copy is faithful.
 */
export async function cacheInventory(root) {
  const entries = [];
  async function walk(directory, relativeDirectory) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => compareText(left.name, right.name));
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const relative = path.posix.join(relativeDirectory, child.name);
      const metadata = await lstat(absolute);
      const mode = metadata.mode & 0o777;
      if (child.isSymbolicLink()) {
        const target = await readlink(absolute);
        const resolvedTarget = path.resolve(path.dirname(absolute), target);
        if (path.isAbsolute(target) || !isWithin(root, resolvedTarget)) {
          throw new Error("Offline cache contains an escaping symbolic link");
        }
        entries.push({ mode, path: relative, target, type: "symbolic_link" });
      } else if (child.isDirectory()) {
        entries.push({ mode, path: `${relative}/`, type: "directory" });
        await walk(absolute, relative);
      } else if (child.isFile()) {
        const bytes = await readFile(absolute);
        entries.push({ byteSize: bytes.length, mode, path: relative, sha256: sha256Hex(bytes), type: "file" });
      } else {
        throw new Error("Offline cache contains an unsupported filesystem entry");
      }
    }
  }
  await walk(root, "");
  return sha256Hex(canonicalStringify(entries));
}

export async function prepareOfflineCache(source, target) {
  if (source === undefined) {
    await mkdir(target);
    return { inventorySha256: sha256Hex(canonicalStringify([])), mode: "empty" };
  }
  if (typeof source !== "string" || source.length === 0) throw new TypeError("offlineCacheSource must be an explicit non-empty path");
  let sourceRoot;
  try {
    sourceRoot = await realpath(source);
  } catch {
    throw new Error("Offline cache source unavailable");
  }
  if (!(await stat(sourceRoot)).isDirectory()) throw new Error("Offline cache source must be a directory");
  const sourceHash = await cacheInventory(sourceRoot);
  await cp(sourceRoot, target, { recursive: true, errorOnExist: true, force: false });
  const copiedHash = await cacheInventory(target);
  if (copiedHash !== sourceHash) throw new Error("Offline cache snapshot differs from its source");
  return { inventorySha256: copiedHash, mode: "caller_snapshot" };
}

export async function snapshotOfflineStore(source, target) {
  if (typeof source !== "string" || source.length === 0) {
    throw new TypeError("offlineStoreSource must be an explicit non-empty path");
  }
  let sourceRoot;
  try {
    sourceRoot = await realpath(source);
  } catch {
    throw new Error("Offline package-manager store source unavailable");
  }
  if (!(await stat(sourceRoot)).isDirectory()) throw new Error("Offline package-manager store source must be a directory");
  const sourceInventorySha256 = await cacheInventory(sourceRoot);
  await cp(sourceRoot, target, { recursive: true, errorOnExist: true, force: false });
  const copiedInventorySha256 = await cacheInventory(target);
  if (copiedInventorySha256 !== sourceInventorySha256) {
    throw new Error("Offline package-manager store snapshot differs from its source");
  }
  return { mode: "caller_snapshot", sourceInventorySha256 };
}
