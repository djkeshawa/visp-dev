/**
 * Normalising a pnpm preparation into a tree that can be compared.
 *
 * pnpm's `list --json` describes a symlink farm, so a node's path is nominal:
 * it must be confined to the fixture, resolved, and then checked against the
 * manifest actually sitting there. An optional dependency that is genuinely
 * absent is recorded as an absence — but only when pnpm's own `.modules.yaml`
 * skipped set agrees it was skipped, and only when the `--no-optional`
 * inventory agrees it is gone. Either half alone would let a MISSING REQUIRED
 * dependency be filed as a deliberate absence, which is the difference between
 * "this graph is complete" and "this graph is whatever installed".
 */
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { canonicalStringify, sha256Hex } from "../../platform/canonical-json.mjs";
import { plainObject } from "../../platform/shape.mjs";
import { DEFAULT_MAX_OUTPUT_BYTES, compareText, runChecked } from "../process.mjs";
import { isWithin } from "../owned-root.mjs";
import { normalizeDependencyTree } from "./npm.mjs";
import { validatePackageName, versionSatisfiesSpec } from "./semver.mjs";
import { classifyPnpmEdge, readPnpmPackageManifest } from "./pnpm-edges.mjs";

function pnpmDependencyMap(node, label) {
  plainObject(node, label);
  const dependencies = new Map();
  for (const groupName of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const group = node[groupName];
    if (group === undefined) continue;
    plainObject(group, `${label} ${groupName}`);
    for (const [name, dependency] of Object.entries(group)) {
      validatePackageName(name);
      plainObject(dependency, `${label} dependency ${name}`);
      if (dependencies.has(name)) {
        throw new Error("Prepared dependency inventory contains a duplicate logical edge");
      }
      dependencies.set(name, dependency);
    }
  }
  return dependencies;
}

function pnpmNodeVersion(node) {
  if (typeof node.version !== "string" || node.version.length === 0 || /[\0\r\n]/u.test(node.version)) {
    throw new Error("Prepared dependency is missing an exact package version");
  }
  return node.version;
}

function validatePnpmNominalPath(nominalPath, fixture) {
  if (typeof nominalPath !== "string" || !path.isAbsolute(nominalPath) || nominalPath.includes("\0")) {
    throw new Error("Prepared dependency has an invalid nominal path");
  }
  const resolvedNominalPath = path.resolve(nominalPath);
  if (!isWithin(fixture, resolvedNominalPath)) {
    throw new Error("Prepared dependency nominal path escapes its snapshot");
  }
  return resolvedNominalPath;
}

function parseSkippedPnpmIdentity(identity) {
  if (typeof identity !== "string" || identity.includes("\0") || /[\r\n]/u.test(identity)) {
    throw new Error("Prepared modules state contains an invalid skipped identity");
  }
  const separator = identity.lastIndexOf("@");
  if (separator <= 0 || separator === identity.length - 1) {
    throw new Error("Prepared modules state contains an invalid skipped identity");
  }
  const name = identity.slice(0, separator);
  const version = identity.slice(separator + 1);
  validatePackageName(name);
  if (/\s/u.test(version)) throw new Error("Prepared modules state contains an invalid skipped identity");
  return { identity, name, version };
}

/** pnpm's own record of what it installed, and what it deliberately skipped. */
async function readPnpmModulesState(fixture, storeRoot, pinnedManager) {
  const modulesPath = path.join(fixture, "node_modules", ".modules.yaml");
  let metadata;
  try {
    metadata = await lstat(modulesPath);
  } catch {
    throw new Error("Pinned pnpm preparation is missing its modules state");
  }
  if (!metadata.isFile() || metadata.size > DEFAULT_MAX_OUTPUT_BYTES) {
    throw new Error("Pinned pnpm modules state is unsupported");
  }
  let modules;
  try {
    modules = JSON.parse(await readFile(modulesPath, "utf8"));
    plainObject(modules, "Pinned pnpm modules state");
  } catch {
    throw new Error("Pinned pnpm modules state is malformed");
  }
  if (modules.packageManager !== pinnedManager) {
    throw new Error("Pinned pnpm modules state has a package-manager mismatch");
  }
  try {
    plainObject(modules.included, "Pinned pnpm modules included state");
  } catch {
    throw new Error("Pinned pnpm modules included state is malformed");
  }
  if (modules.included.dependencies !== true
    || modules.included.devDependencies !== true
    || modules.included.optionalDependencies !== true) {
    throw new Error("Pinned pnpm modules state did not include the complete dependency graph");
  }
  if (typeof modules.storeDir !== "string" || !path.isAbsolute(modules.storeDir) || modules.storeDir.includes("\0")) {
    throw new Error("Pinned pnpm modules state has an invalid store path");
  }
  const lexicalStore = path.resolve(modules.storeDir);
  const confinedStoreRoot = await realpath(storeRoot);
  if (!isWithin(confinedStoreRoot, lexicalStore)) {
    throw new Error("Pinned pnpm modules state references a foreign store");
  }
  let actualStore;
  try {
    actualStore = await realpath(lexicalStore);
  } catch {
    throw new Error("Pinned pnpm modules state references an unavailable store");
  }
  if (!isWithin(confinedStoreRoot, actualStore) || !(await stat(actualStore)).isDirectory()) {
    throw new Error("Pinned pnpm modules state references a foreign store");
  }
  if (!Array.isArray(modules.skipped)) {
    throw new Error("Pinned pnpm modules state has an invalid skipped set");
  }
  const skipped = new Map();
  for (const rawIdentity of modules.skipped) {
    const parsed = parseSkippedPnpmIdentity(rawIdentity);
    if (skipped.has(parsed.identity)) {
      throw new Error("Pinned pnpm modules state contains a duplicate skipped identity");
    }
    skipped.set(parsed.identity, parsed);
  }
  return skipped;
}

function parsePnpmTree(result, label) {
  if (result.stdout.truncated || result.stderr.truncated) {
    throw new Error(`${label} exceeded bounded capture`);
  }
  let rawTree;
  try {
    rawTree = JSON.parse(result.stdout.text);
    if (Array.isArray(rawTree)) {
      if (rawTree.length !== 1) throw new Error("unexpected root count");
      [rawTree] = rawTree;
    }
    plainObject(rawTree, label);
  } catch {
    throw new Error(`${label} returned malformed JSON`);
  }
  return rawTree;
}

function matchingNoOptionalNode(fullNode, noOptionalNode) {
  if (pnpmNodeVersion(fullNode) !== pnpmNodeVersion(noOptionalNode)
    || fullNode.path !== noOptionalNode.path
    || fullNode.from !== noOptionalNode.from) {
    throw new Error("Full and no-optional dependency inventories contradict");
  }
}

async function normalizePnpmDependencyTree({
  name,
  node,
  noOptionalNode,
  fixture,
  edge,
  logicalPath,
  root,
  skipped,
  absences,
}) {
  plainObject(node, `Prepared dependency ${name}`);
  validatePackageName(name);
  const version = pnpmNodeVersion(node);
  const nominalPath = validatePnpmNominalPath(node.path, fixture);
  if (noOptionalNode !== null) {
    plainObject(noOptionalNode, `No-optional dependency ${name}`);
    matchingNoOptionalNode(node, noOptionalNode);
  }

  let nominalMetadata;
  try {
    nominalMetadata = await lstat(nominalPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (root || edge.kind !== "optional") {
      throw new Error("Required prepared dependency is missing");
    }
    if (noOptionalNode !== null) {
      throw new Error("Missing optional dependency remains in the no-optional inventory");
    }
    if (edge.targetName !== name) {
      throw new Error("Missing optional npm aliases are unsupported");
    }
    const identity = `${name}@${version}`;
    if (!skipped.has(identity)) {
      throw new Error("Missing optional dependency is absent from pinned pnpm skipped state");
    }
    absences.push({
      name,
      path: logicalPath,
      source: "pnpm_skipped",
      status: "optional_absent",
      version,
    });
    return null;
  }
  if (!nominalMetadata.isDirectory() && !nominalMetadata.isSymbolicLink()) {
    throw new Error("Prepared dependency nominal path is unsupported");
  }

  let packageRoot;
  try {
    packageRoot = await realpath(nominalPath);
  } catch {
    throw new Error("Prepared dependency path could not be resolved");
  }
  if (!isWithin(fixture, packageRoot)) throw new Error("Prepared dependency resolves outside its snapshot");
  const manifest = await readPnpmPackageManifest(packageRoot);
  const expectedName = root ? name : edge.targetName;
  if ((!root && node.from !== expectedName)
    || manifest.name !== expectedName
    || manifest.version !== version) {
    throw new Error("Prepared dependency inventory identity does not match its installed manifest");
  }
  if (!root && edge.alias && !versionSatisfiesSpec(version, edge.authoredSpec)) {
    throw new Error("Prepared dependency version does not satisfy its authored manifest spec");
  }
  const identity = `${expectedName}@${version}`;
  if (skipped.has(identity)) {
    throw new Error("Installed prepared dependency is listed as skipped");
  }

  const dependencyMap = pnpmDependencyMap(node, `Prepared dependency ${name}`);
  const noOptionalMap = noOptionalNode === null
    ? null
    : pnpmDependencyMap(noOptionalNode, `No-optional dependency ${name}`);
  const dependencies = [];
  for (const [dependencyName, dependency] of [...dependencyMap].sort(([left], [right]) => compareText(left, right))) {
    const childEdge = classifyPnpmEdge(manifest, dependencyName, root);
    const noOptionalDependency = noOptionalMap?.get(dependencyName) ?? null;
    if (childEdge.kind === "optional" && noOptionalDependency !== null) {
      throw new Error(
        `Optional dependency remains in the no-optional inventory: ${logicalPath} -> ${dependencyName}`,
      );
    }
    const normalized = await normalizePnpmDependencyTree({
      name: dependencyName,
      node: dependency,
      noOptionalNode: noOptionalDependency,
      fixture,
      edge: childEdge,
      logicalPath: path.posix.join(logicalPath, "node_modules", dependencyName),
      root: false,
      skipped,
      absences,
    });
    if (normalized !== null) dependencies.push(normalized);
  }
  return { dependencies, name, version };
}

export async function preparedDependencyTree(
  managerExecutable,
  managerName,
  fixture,
  environment,
  { pinnedManager = null, storeRoot = null } = {},
) {
  const args = managerName === "pnpm"
    ? ["list", "--depth", "Infinity", "--json"]
    : ["ls", "--all", "--json"];
  const result = await runChecked(
    managerExecutable,
    args,
    { cwd: fixture, env: environment },
    "Prepared dependency inventory",
  );
  if (managerName !== "pnpm") {
    let rawTree;
    try {
      rawTree = JSON.parse(result.stdout.text);
      if (Array.isArray(rawTree)) {
        if (rawTree.length !== 1) throw new Error("unexpected root count");
        [rawTree] = rawTree;
      }
    } catch {
      throw new Error("Prepared dependency inventory returned malformed JSON");
    }
    const tree = normalizeDependencyTree(rawTree.name ?? "prepared-package", rawTree);
    return { sha256: sha256Hex(canonicalStringify(tree)), tree };
  }

  const rawTree = parsePnpmTree(result, "Prepared dependency inventory");
  const noOptionalResult = await runChecked(
    managerExecutable,
    [...args, "--no-optional"],
    { cwd: fixture, env: environment },
    "Prepared no-optional dependency inventory",
  );
  const noOptionalTree = parsePnpmTree(noOptionalResult, "Prepared no-optional dependency inventory");
  if (typeof rawTree.name !== "string" || typeof noOptionalTree.name !== "string" || rawTree.name !== noOptionalTree.name) {
    throw new Error("Full and no-optional dependency inventory roots contradict");
  }
  const skipped = await readPnpmModulesState(fixture, storeRoot, pinnedManager);
  const absences = [];
  const tree = await normalizePnpmDependencyTree({
    name: rawTree.name,
    node: rawTree,
    noOptionalNode: noOptionalTree,
    fixture,
    edge: null,
    logicalPath: ".",
    root: true,
    skipped,
    absences,
  });
  absences.sort((left, right) => compareText(canonicalStringify(left), canonicalStringify(right)));
  return {
    absenceSha256: sha256Hex(canonicalStringify(absences)),
    absences,
    sha256: sha256Hex(canonicalStringify(tree)),
    tree,
  };
}
