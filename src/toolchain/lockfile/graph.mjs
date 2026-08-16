/**
 * What is on disk after an install, checked against the lock that authorised it.
 *
 * Validating the lock proves the lock is closed. It does not prove the
 * installer honoured it. This walks the validated graph and reads each
 * package's real manifest, so a package installed at a different version — or
 * with different dependency specs — is caught rather than assumed away.
 */
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { canonicalStringify, sha256Hex } from "../../platform/canonical-json.mjs";
import { DEFAULT_MAX_OUTPUT_BYTES } from "../process.mjs";
import { isWithin } from "../owned-root.mjs";

export async function verifyInstalledLockGraph(fixture, installLock) {
  if (installLock === null) return;
  const packages = [];
  for (const expected of installLock.graph) {
    const packageRoot = path.join(fixture, ...expected.key.split("/"));
    let rootMetadata;
    try {
      rootMetadata = await lstat(packageRoot);
    } catch {
      throw new Error("Installed package identity is missing from the validated lock graph");
    }
    if (!rootMetadata.isDirectory() || !isWithin(fixture, await realpath(packageRoot))) {
      throw new Error("Installed package identity is outside the validated lock graph");
    }
    const manifestPath = path.join(packageRoot, "package.json");
    let manifestMetadata;
    try {
      manifestMetadata = await lstat(manifestPath);
    } catch {
      throw new Error("Installed package identity has no package manifest");
    }
    if (!manifestMetadata.isFile() || manifestMetadata.size > DEFAULT_MAX_OUTPUT_BYTES) {
      throw new Error("Installed package identity manifest is unsupported");
    }
    const manifestBytes = await readFile(manifestPath);
    let manifest;
    try {
      manifest = JSON.parse(manifestBytes.toString("utf8"));
    } catch {
      throw new Error("Installed package identity manifest is malformed");
    }
    if (manifest.name !== expected.name || manifest.version !== expected.version) {
      throw new Error("Installed package identity does not match the validated lock entry");
    }
    for (const groupName of ["dependencies", "optionalDependencies"]) {
      if (canonicalStringify(manifest[groupName] ?? {}) !== canonicalStringify(expected[groupName])) {
        throw new Error("Installed package dependency specs do not match the validated lock entry");
      }
    }
    packages.push({
      integrity: expected.integrity,
      key: expected.key,
      manifestSha256: sha256Hex(manifestBytes),
      name: expected.name,
      version: expected.version,
    });
  }
  installLock.packages = packages;
}
