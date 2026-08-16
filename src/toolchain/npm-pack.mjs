/**
 * Packing a pinned commit — twice, independently — and proving the two agree.
 *
 * Two snapshots, two preparations, two packs. Byte equality of the tarballs is
 * the claim; the member inventory and the packed manifest are checked too, so a
 * pack that differed only in metadata could not pass on byte luck.
 */
import { mkdir, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import { canonicalStringify, sha256Hex } from "../platform/canonical-json.mjs";
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  findExecutable,
  runChecked,
  trimLine,
} from "./process.mjs";
import { findOwnedRoot, requireOwnedPath } from "./owned-root.mjs";
import { resolveCommit, snapshotCommit } from "./git-snapshot.mjs";
import { normalizeBins, packageIdentity } from "./manifest.mjs";
import { npmEnvironment, snapshotOfflineStore } from "./npm-environment.mjs";
import { preparedDependencyTree } from "./lockfile/pnpm.mjs";

export { normalizeBins, packageIdentity };

export async function packageSnapshot({
  snapshotRoot,
  outputDirectory,
  npmCommand,
  packageManagerExecutable,
  maxTarInventoryBytes,
}) {
  const snapshot = await realpath(snapshotRoot);
  const { absolute: output } = await requireOwnedPath(outputDirectory, "outputDirectory");
  await mkdir(output, { recursive: false });
  const npmExecutable = await findExecutable(npmCommand);
  if (!npmExecutable) throw new Error("Package tool unavailable");
  const environment = await npmEnvironment({
    executables: [npmExecutable, packageManagerExecutable].filter(Boolean),
    configurationDirectory: path.join(output, ".npm-config"),
    cacheDirectory: path.join(output, ".npm-cache"),
    ignoreScripts: false,
  });
  const versionResult = await runChecked(npmExecutable, ["--version"], { env: environment }, "Package tool version");
  await runChecked(
    npmExecutable,
    ["pack", "--offline", "--ignore-scripts=false", "--pack-destination", output],
    { cwd: snapshot, env: environment },
    "Package pack",
  );
  const packedFiles = (await readdir(output)).filter((name) => name.endsWith(".tgz")).sort();
  if (packedFiles.length !== 1) throw new Error("Package tool must create exactly one tarball");
  const [filename] = packedFiles;
  const tarballPath = path.join(output, filename);
  const bytes = await readFile(tarballPath);
  const tarExecutable = await findExecutable("tar");
  if (!tarExecutable) throw new Error("Tar inventory tool unavailable");
  const inventoryResult = await runChecked(
    tarExecutable,
    ["-tf", tarballPath],
    { maxOutputBytes: maxTarInventoryBytes },
    "Tar inventory",
  );
  if (inventoryResult.stdout.truncated || inventoryResult.stderr.truncated) {
    const error = new Error("Tar inventory output exceeded bounded capture");
    error.code = "TAR_INVENTORY_TRUNCATED";
    error.observation = inventoryResult;
    throw error;
  }
  const members = inventoryResult.stdout.text.split(/\r?\n/u).filter(Boolean).sort();
  if (!members.includes("package/package.json")) throw new Error("Packed archive is missing package/package.json");
  const packedManifestResult = await runChecked(
    tarExecutable,
    ["-xOf", tarballPath, "package/package.json"],
    { maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES },
    "Packed package identity",
  );
  if (packedManifestResult.stdout.truncated || packedManifestResult.stderr.bytes !== 0) {
    throw new Error("Packed package identity could not be read faithfully");
  }
  let packedManifest;
  try {
    packedManifest = JSON.parse(packedManifestResult.stdout.text);
  } catch {
    throw new Error("Packed package identity is malformed");
  }
  const observation = {
    byteSize: bytes.length,
    memberListSha256: sha256Hex(`${members.join("\n")}\n`),
    memberListBytes: inventoryResult.stdout.bytes,
    members,
    package: packageIdentity(packedManifest),
    sha256: sha256Hex(bytes),
    tool: { lifecycleScriptsPolicy: "required", name: "npm", version: trimLine(versionResult.stdout) },
  };
  Object.defineProperties(observation, {
    bytes: { value: bytes, enumerable: false },
    tarballPath: { value: tarballPath, enumerable: false },
  });
  return observation;
}

export function assertMatchingPacks(first, second) {
  const byteEqual = Buffer.isBuffer(first.bytes) && Buffer.isBuffer(second.bytes)
    ? first.bytes.equals(second.bytes)
    : first.sha256 === second.sha256 && first.byteSize === second.byteSize;
  if (!byteEqual) throw new Error("Independent package bytes differ");
  if (first.sha256 !== second.sha256 || first.byteSize !== second.byteSize || first.memberListSha256 !== second.memberListSha256) {
    throw new Error("Independent package inventory differs");
  }
  if (canonicalStringify(first.package) !== canonicalStringify(second.package)) {
    throw new Error("Independent packed package identities differ");
  }
}

function parsePackageManager(packageManager) {
  if (typeof packageManager !== "string") return null;
  const match = /^(npm|pnpm)@([0-9A-Za-z.+-]+)$/u.exec(packageManager);
  if (!match) throw new Error("package.json packageManager must pin npm or pnpm to an exact version");
  return { name: match[1], pinned: packageManager, version: match[2] };
}

/**
 * The offline dependency install a package must complete before it can be
 * packed, when it pins a package manager.
 *
 * Lifecycle scripts are disabled here and enabled during `pack`: preparing a
 * tree must not run foreign code, but a package's own `prepack` is part of what
 * it publishes and skipping it would pack something the registry never sees.
 */
async function preparePackageSnapshot({
  snapshotRoot,
  preparationDirectory,
  offlineStoreSource,
  packageManagerCommand,
  npmCommand,
}) {
  const packageJson = JSON.parse(await readFile(path.join(snapshotRoot, "package.json"), "utf8"));
  const declaration = parsePackageManager(packageJson.packageManager);
  if (!declaration) {
    if (offlineStoreSource !== undefined || packageManagerCommand !== undefined) {
      throw new Error("Package preparation inputs require a pinned package.json packageManager");
    }
    return null;
  }
  if (offlineStoreSource === undefined) {
    throw new Error("Pinned package preparation requires a caller-supplied offline store");
  }
  const managerExecutable = await findExecutable(packageManagerCommand ?? declaration.name);
  if (!managerExecutable) throw new Error("Pinned package manager unavailable");
  const npmExecutable = await findExecutable(npmCommand);
  if (!npmExecutable) throw new Error("Package inventory tool unavailable");
  const { absolute: preparation } = await requireOwnedPath(preparationDirectory, "preparationDirectory");
  await mkdir(preparation);
  const storePath = path.join(preparation, "store");
  const store = await snapshotOfflineStore(offlineStoreSource, storePath);
  const environment = await npmEnvironment({
    executables: [managerExecutable, npmExecutable],
    configurationDirectory: path.join(preparation, "config"),
    cacheDirectory: storePath,
    ignoreScripts: true,
  });
  const versionResult = await runChecked(managerExecutable, ["--version"], { env: environment }, "Pinned package-manager version");
  const actualVersion = trimLine(versionResult.stdout);
  if (actualVersion !== declaration.version) {
    throw new Error(
      `Pinned package manager mismatch: expected ${declaration.pinned}, received stdout ${JSON.stringify(actualVersion)} `
      + `and stderr ${JSON.stringify(trimLine(versionResult.stderr))}`,
    );
  }
  const lockfileName = declaration.name === "pnpm" ? "pnpm-lock.yaml" : "package-lock.json";
  const lockfilePath = path.join(snapshotRoot, lockfileName);
  let lockfileBytes;
  try {
    lockfileBytes = await readFile(lockfilePath);
  } catch {
    throw new Error(`Pinned package preparation requires ${lockfileName}`);
  }
  const preparationArgs = declaration.name === "pnpm"
    ? [
      "install",
      "--offline",
      "--frozen-lockfile",
      "--trust-lockfile",
      "--ignore-scripts",
      "--package-import-method",
      "copy",
      "--store-dir",
      storePath,
    ]
    : ["ci", "--offline", "--ignore-scripts", "--include=dev", "--cache", storePath];
  await runChecked(
    managerExecutable,
    preparationArgs,
    { cwd: snapshotRoot, env: environment, timeoutMs: 120_000 },
    "Offline lockfile preparation",
  );
  const record = {
    dependencyTree: await preparedDependencyTree(managerExecutable, declaration.name, snapshotRoot, environment, {
      pinnedManager: declaration.pinned,
      storeRoot: storePath,
    }),
    lifecycleScriptsDisabled: true,
    lockfile: { path: lockfileName, sha256: sha256Hex(lockfileBytes) },
    offline: true,
    store: {
      ...store,
    },
    tool: { name: declaration.name, pinned: declaration.pinned, version: actualVersion },
  };
  Object.defineProperty(record, "executable", { enumerable: false, value: managerExecutable });
  return record;
}

function publicPreparation(preparation) {
  return preparation === null ? null : JSON.parse(canonicalStringify(preparation));
}

export async function packPackageTwice({
  repositoryRoot,
  commit,
  ownedRoot,
  npmCommand = "npm",
  packageManagerCommand,
  offlineStoreSource,
  maxTarInventoryBytes = DEFAULT_MAX_OUTPUT_BYTES,
}) {
  if (!Number.isInteger(maxTarInventoryBytes) || maxTarInventoryBytes <= 0) {
    throw new TypeError("maxTarInventoryBytes must be a positive integer");
  }
  const owned = await realpath(ownedRoot);
  const markerRoot = await findOwnedRoot(owned);
  if (markerRoot !== owned) throw new Error("ownedRoot is not a laboratory-owned temporary root");
  const resolved = await resolveCommit({ repositoryRoot, commit });
  const snapshot1 = path.join(owned, "snapshot-1");
  const snapshot2 = path.join(owned, "snapshot-2");
  await snapshotCommit({ repositoryRoot, commit, destination: snapshot1 });
  await snapshotCommit({ repositoryRoot, commit, destination: snapshot2 });
  const firstPreparation = await preparePackageSnapshot({
    snapshotRoot: snapshot1,
    preparationDirectory: path.join(owned, "preparation-1"),
    offlineStoreSource,
    packageManagerCommand,
    npmCommand,
  });
  const secondPreparation = await preparePackageSnapshot({
    snapshotRoot: snapshot2,
    preparationDirectory: path.join(owned, "preparation-2"),
    offlineStoreSource,
    packageManagerCommand,
    npmCommand,
  });
  if (canonicalStringify(firstPreparation) !== canonicalStringify(secondPreparation)) {
    throw new Error("Independent package preparations differ");
  }
  const first = await packageSnapshot({
    snapshotRoot: snapshot1,
    outputDirectory: path.join(owned, "pack-1"),
    npmCommand,
    packageManagerExecutable: firstPreparation?.executable,
    maxTarInventoryBytes,
  });
  const second = await packageSnapshot({
    snapshotRoot: snapshot2,
    outputDirectory: path.join(owned, "pack-2"),
    npmCommand,
    packageManagerExecutable: secondPreparation?.executable,
    maxTarInventoryBytes,
  });
  assertMatchingPacks(first, second);
  return {
    ...resolved,
    package: first.package,
    preparations: {
      first: publicPreparation(firstPreparation),
      second: publicPreparation(secondPreparation),
    },
    first,
    second,
    tarballPath: first.tarballPath,
  };
}

export async function readPackedManifest(tarballPath) {
  const tarExecutable = await findExecutable("tar");
  if (!tarExecutable) throw new Error("Tar inventory tool unavailable");
  const result = await runChecked(
    tarExecutable,
    ["-xOf", tarballPath, "package/package.json"],
    { maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES },
    "Packed package manifest",
  );
  if (result.stdout.truncated || result.stderr.bytes !== 0) throw new Error("Packed package manifest could not be read faithfully");
  let packageJson;
  try {
    packageJson = JSON.parse(result.stdout.text);
  } catch {
    throw new Error("Packed package manifest is malformed");
  }
  packageIdentity(packageJson);
  return packageJson;
}
