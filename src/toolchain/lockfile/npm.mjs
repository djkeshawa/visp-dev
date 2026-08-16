/**
 * Validating an npm lockfile-v3 install lock, then materialising it.
 *
 * The lock is not trusted because it is present. Every entry must be exact and
 * integrity-pinned, every registry URL must be the canonical artifact URL for
 * the name and version it claims, and every declared dependency must resolve
 * through real npm hoisting rules to an entry that satisfies the authored spec.
 * Anything unreachable from the local package is refused as extraneous — an
 * install lock with an unreachable entry describes a graph npm would not build.
 */
import { createHash } from "node:crypto";
import { readFile, stat, realpath, writeFile } from "node:fs/promises";

import { canonicalStringify, sha256Hex } from "../../platform/canonical-json.mjs";
import { plainObject } from "../../platform/shape.mjs";
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  compareText,
  rejectUnknownKeys,
  runChecked,
} from "../process.mjs";
import { normalizeBins } from "../manifest.mjs";
import {
  parseAuthoredDependencySpec,
  validateExactVersion,
  validatePackageName,
  versionSatisfiesSpec,
} from "./semver.mjs";

const LOCAL_TARBALL_PLACEHOLDER = "file:__VISP_LOCAL_TARBALL__";

/** `node_modules/a/node_modules/b`, parsed and required to be canonical. */
function parseLockPackageKey(key) {
  if (typeof key !== "string" || key === "") throw new Error("Offline install lock contains an unsupported package path");
  const segments = key.split("/");
  let index = 0;
  let parentKey = null;
  let currentKey = "";
  let name = null;
  while (index < segments.length) {
    if (segments[index] !== "node_modules") throw new Error("Offline install lock contains an unsupported package path");
    index += 1;
    if (index >= segments.length) throw new Error("Offline install lock contains an unsupported package path");
    if (segments[index].startsWith("@")) {
      if (index + 1 >= segments.length) throw new Error("Offline install lock contains an unsupported package path");
      name = `${segments[index]}/${segments[index + 1]}`;
      index += 2;
    } else {
      name = segments[index];
      index += 1;
    }
    validatePackageName(name);
    parentKey = currentKey === "" ? null : currentKey;
    currentKey = currentKey === "" ? `node_modules/${name}` : `${currentKey}/node_modules/${name}`;
  }
  if (currentKey !== key) throw new Error("Offline install lock contains a non-canonical package path");
  return { key, name, parentKey };
}

function dependencyDeclarations(entry, owner) {
  const declarations = new Map();
  for (const groupName of ["dependencies", "optionalDependencies"]) {
    const group = entry[groupName];
    if (group === undefined) continue;
    plainObject(group, `${owner} ${groupName}`);
    for (const [name, version] of Object.entries(group)) {
      validatePackageName(name);
      parseAuthoredDependencySpec(version);
      if (declarations.has(name)) {
        throw new Error("Offline install lock contains an ambiguous dependency declaration");
      }
      declarations.set(name, version);
    }
  }
  if (entry.peerDependencies !== undefined) {
    throw new Error("Offline install lock peer dependencies are unsupported");
  }
  return new Map([...declarations.entries()].sort(([left], [right]) => compareText(left, right)));
}

function canonicalRegistryArtifactUrl(name, version) {
  const basename = name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name;
  return `https://registry.npmjs.org/${name}/-/${basename}-${version}.tgz`;
}

/**
 * The resolved URL must be the canonical artifact URL, byte for byte.
 *
 * Decoded per segment first, so a percent-encoded traversal cannot smuggle a
 * different path past a string comparison, and the raw string is compared too
 * so an equivalent-but-different encoding is refused rather than accepted.
 */
function validateRegistryArtifactUrl(resolvedValue, name, version) {
  if (typeof resolvedValue !== "string") throw new Error("Offline install lock registry package has an invalid URL");
  let resolved;
  try {
    resolved = new URL(resolvedValue);
  } catch {
    throw new Error("Offline install lock registry package has an invalid URL");
  }
  const decodedSegments = resolved.pathname.split("/").slice(1).map((segment) => {
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error("Offline install lock registry package has a malformed encoded path");
    }
    if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) {
      throw new Error("Offline install lock registry package has an unsafe encoded path");
    }
    return decoded;
  });
  const expected = canonicalRegistryArtifactUrl(name, version);
  const expectedPath = new URL(expected).pathname.split("/").slice(1);
  if (resolved.origin !== "https://registry.npmjs.org"
    || resolved.username !== ""
    || resolved.password !== ""
    || resolved.search !== ""
    || resolved.hash !== ""
    || canonicalStringify(decodedSegments) !== canonicalStringify(expectedPath)
    || resolvedValue !== expected) {
    throw new Error("Offline install lock registry package must use its canonical npm registry artifact URL");
  }
}

/** npm hoisting: nearest `node_modules` up the owner chain, then the root. */
function resolveLockedDependency(packages, packageMetadata, ownerKey, name, requestedSpec) {
  const validateResolution = (candidate) => {
    const resolvedVersion = packages[candidate].version;
    if (!versionSatisfiesSpec(resolvedVersion, requestedSpec)) {
      throw new Error("Offline install lock resolved version does not satisfy authored dependency spec");
    }
    return candidate;
  };
  let ancestor = ownerKey;
  while (ancestor !== null) {
    const candidate = `${ancestor}/node_modules/${name}`;
    if (packages[candidate] !== undefined) {
      return validateResolution(candidate);
    }
    ancestor = packageMetadata.get(ancestor)?.parentKey ?? null;
  }
  const hoisted = `node_modules/${name}`;
  if (packages[hoisted] !== undefined) {
    return validateResolution(hoisted);
  }
  throw new Error("Offline install lock dependency graph contains a missing or misplaced dependency");
}

export async function prepareOfflineInstallLock({ source, target, tarballPath, packageJson }) {
  if (typeof source !== "string" || source.length === 0) {
    throw new TypeError("offlineInstallLockSource must be an explicit non-empty path");
  }
  let sourcePath;
  try {
    sourcePath = await realpath(source);
  } catch {
    throw new Error("Offline install lock source unavailable");
  }
  if (!(await stat(sourcePath)).isFile()) throw new Error("Offline install lock source must be a regular file");
  const sourceBytes = await readFile(sourcePath);
  if (sourceBytes.length > DEFAULT_MAX_OUTPUT_BYTES) throw new Error("Offline install lock exceeds its size bound");
  let lock;
  try {
    lock = JSON.parse(sourceBytes.toString("utf8"));
  } catch {
    throw new Error("Offline install lock is malformed");
  }
  plainObject(lock, "offline install lock");
  rejectUnknownKeys(lock, new Set(["name", "version", "lockfileVersion", "requires", "packages"]), "offline install lock");
  if (lock.lockfileVersion !== 3 || lock.requires !== true) throw new Error("Offline install lock must use lockfileVersion 3");
  plainObject(lock.packages, "offline install lock packages");
  const packageKey = `node_modules/${packageJson.name}`;
  validatePackageName(packageJson.name);
  const root = lock.packages[""];
  const localPackage = lock.packages[packageKey];
  plainObject(root, "offline install lock root");
  plainObject(localPackage, "offline install lock local package");
  const rootDependencies = root.dependencies;
  if (root.name !== "visp-compatibility-install"
    || root.private !== true
    || canonicalStringify(rootDependencies) !== canonicalStringify({ [packageJson.name]: LOCAL_TARBALL_PLACEHOLDER })) {
    throw new Error("Offline install lock root must reference only the local tarball placeholder");
  }
  const tarballBytes = await readFile(tarballPath);
  const expectedIntegrity = `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`;
  if (localPackage.version !== packageJson.version
    || localPackage.resolved !== LOCAL_TARBALL_PLACEHOLDER
    || localPackage.integrity !== expectedIntegrity) {
    throw new Error("Offline install lock local package identity does not match the packed tarball");
  }
  let lockedBins;
  try {
    lockedBins = normalizeBins({ name: packageJson.name, bin: localPackage.bin });
  } catch {
    throw new Error("Offline install lock local package bin metadata is malformed");
  }
  if (canonicalStringify(lockedBins) !== canonicalStringify(normalizeBins(packageJson))) {
    throw new Error("Offline install lock local package bin metadata does not match the packed tarball");
  }
  for (const groupName of ["dependencies", "optionalDependencies"]) {
    if (canonicalStringify(localPackage[groupName] ?? {}) !== canonicalStringify(packageJson[groupName] ?? {})) {
      throw new Error("Offline install lock does not match packed package dependencies");
    }
  }
  const packageMetadata = new Map();
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === "") continue;
    const metadata = parseLockPackageKey(key);
    plainObject(entry, `offline install lock package ${key}`);
    validateExactVersion(entry.version);
    if (typeof entry.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(entry.integrity)) {
      throw new Error("Offline install lock registry package is not exact and integrity-pinned");
    }
    if (key !== packageKey) validateRegistryArtifactUrl(entry.resolved, metadata.name, entry.version);
    packageMetadata.set(key, metadata);
  }
  const visited = new Set();
  const queue = [packageKey];
  const edges = [];
  while (queue.length > 0) {
    const ownerKey = queue.shift();
    if (visited.has(ownerKey)) continue;
    const owner = lock.packages[ownerKey];
    if (owner === undefined) throw new Error("Offline install lock dependency graph is incomplete");
    visited.add(ownerKey);
    for (const [name, requestedSpec] of dependencyDeclarations(owner, ownerKey)) {
      const resolvedKey = resolveLockedDependency(lock.packages, packageMetadata, ownerKey, name, requestedSpec);
      edges.push({
        ownerKey,
        requestedName: name,
        requestedSpec,
        resolvedKey,
        resolvedVersion: lock.packages[resolvedKey].version,
      });
      queue.push(resolvedKey);
    }
  }
  const packageKeys = [...packageMetadata.keys()].sort(compareText);
  const extraneous = packageKeys.filter((key) => !visited.has(key));
  if (extraneous.length > 0) throw new Error("Offline install lock contains an extraneous package entry");
  const graph = packageKeys.map((key) => ({
    dependencies: lock.packages[key].dependencies ?? {},
    integrity: lock.packages[key].integrity,
    key,
    name: packageMetadata.get(key).name,
    optionalDependencies: lock.packages[key].optionalDependencies ?? {},
    version: lock.packages[key].version,
  }));
  edges.sort((left, right) => compareText(canonicalStringify(left), canonicalStringify(right)));
  const materialized = structuredClone(lock);
  materialized.packages[""].dependencies[packageJson.name] = `file:${tarballPath}`;
  materialized.packages[packageKey].resolved = `file:${tarballPath}`;
  await writeFile(target, canonicalStringify(materialized), { flag: "wx", mode: 0o600 });
  const record = {
    edgeSha256: sha256Hex(canonicalStringify(edges)),
    edges,
    graphSha256: sha256Hex(canonicalStringify(graph)),
    packages: [],
    path: "package-lock.json",
    sha256: sha256Hex(sourceBytes),
  };
  Object.defineProperty(record, "graph", { enumerable: false, value: graph });
  return record;
}

/** An `npm ls --all --json` tree, flattened to name/version/children. */
export function normalizeDependencyTree(name, node) {
  const dependencyGroups = [node.dependencies, node.devDependencies, node.optionalDependencies]
    .filter((group) => group && typeof group === "object");
  const dependencyMap = Object.assign({}, ...dependencyGroups);
  const dependencies = Object.keys(dependencyMap).length > 0
    ? Object.entries(dependencyMap)
      .sort(([left], [right]) => compareText(left, right))
      .map(([dependencyName, dependency]) => normalizeDependencyTree(dependencyName, dependency))
    : [];
  return {
    dependencies,
    name,
    version: typeof node.version === "string" ? node.version : null,
  };
}

export async function installedDependencyTree(npmExecutable, fixture, environment) {
  const result = await runChecked(
    npmExecutable,
    ["ls", "--all", "--json"],
    { cwd: fixture, env: environment },
    "Installed dependency inventory",
  );
  let rawTree;
  try {
    rawTree = JSON.parse(result.stdout.text);
  } catch {
    throw new Error("Installed dependency inventory returned malformed JSON");
  }
  const tree = normalizeDependencyTree(rawTree.name ?? "visp-compatibility-install", rawTree);
  return { sha256: sha256Hex(canonicalStringify(tree)), tree };
}
