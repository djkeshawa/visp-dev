/**
 * What a prepared package's own manifest says about each of its edges.
 *
 * The classification is what decides whether an absent dependency is a
 * deliberate optional skip or a broken install. See `classifyPnpmEdge`.
 */
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import { plainObject } from "../../platform/shape.mjs";
import { DEFAULT_MAX_OUTPUT_BYTES } from "../process.mjs";
import { parseAuthoredDependencySpec, validatePackageName } from "./semver.mjs";

async function readPnpmPackageManifest(packageRoot) {
  const manifestPath = path.join(packageRoot, "package.json");
  let metadata;
  try {
    metadata = await lstat(manifestPath);
  } catch {
    throw new Error("Prepared dependency is missing its package manifest");
  }
  if (!metadata.isFile() || metadata.size > DEFAULT_MAX_OUTPUT_BYTES) {
    throw new Error("Prepared dependency package manifest is unsupported");
  }
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    plainObject(manifest, "Prepared dependency package manifest");
  } catch {
    throw new Error("Prepared dependency package manifest is malformed");
  }
  if (typeof manifest.name !== "string"
    || typeof manifest.version !== "string"
    || manifest.name.length === 0
    || manifest.version.length === 0) {
    throw new Error("Prepared dependency package manifest has no exact identity");
  }
  return manifest;
}

function manifestDependencyGroup(manifest, groupName) {
  const group = manifest[groupName];
  if (group === undefined) return {};
  plainObject(group, `Prepared package manifest ${groupName}`);
  return group;
}

/** `npm:target@spec` aliases resolved to the name actually installed. */
function parsePnpmAuthoredEdge(dependencyName, authoredSpec) {
  if (typeof authoredSpec !== "string"
    || authoredSpec.length === 0
    || authoredSpec !== authoredSpec.trim()
    || /[\0\r\n]/u.test(authoredSpec)) {
    throw new Error("Prepared package manifest contains an unsupported dependency spec");
  }
  if (!authoredSpec.startsWith("npm:")) {
    return { alias: false, authoredSpec, targetName: dependencyName };
  }
  const aliasSpec = authoredSpec.slice("npm:".length);
  const versionSeparator = aliasSpec.lastIndexOf("@");
  if (versionSeparator <= 0 || versionSeparator === aliasSpec.length - 1) {
    throw new Error("Prepared package manifest contains a malformed npm alias");
  }
  const targetName = aliasSpec.slice(0, versionSeparator);
  const targetSpec = aliasSpec.slice(versionSeparator + 1);
  validatePackageName(targetName);
  parseAuthoredDependencySpec(targetSpec);
  return { alias: true, authoredSpec: targetSpec, targetName };
}

function optionalPeerDependency(parentManifest, dependencyName) {
  const metadata = parentManifest.peerDependenciesMeta;
  if (metadata === undefined) return false;
  plainObject(metadata, "Prepared package manifest peerDependenciesMeta");
  const entry = metadata[dependencyName];
  if (entry === undefined) return false;
  plainObject(entry, `Prepared package manifest peerDependenciesMeta.${dependencyName}`);
  if (entry.optional !== undefined && typeof entry.optional !== "boolean") {
    throw new Error("Prepared package manifest contains invalid optional peer metadata");
  }
  return entry.optional === true;
}

/**
 * Which group declared this edge, and whether it may legitimately be absent.
 *
 * An edge declared in two groups with different specs is ambiguous and refused:
 * which one the installer honoured would decide whether an absence is allowed,
 * and guessing would make the absence rule depend on group ordering.
 */
function classifyPnpmEdge(parentManifest, dependencyName, root) {
  const optional = manifestDependencyGroup(parentManifest, "optionalDependencies");
  const required = manifestDependencyGroup(parentManifest, "dependencies");
  const development = root ? manifestDependencyGroup(parentManifest, "devDependencies") : {};
  const peer = manifestDependencyGroup(parentManifest, "peerDependencies");
  const inOptional = Object.hasOwn(optional, dependencyName);
  const inRequired = Object.hasOwn(required, dependencyName);
  const inDevelopment = Object.hasOwn(development, dependencyName);
  const inPeer = Object.hasOwn(peer, dependencyName);
  if (inOptional) {
    if (inDevelopment
      || inPeer
      || (inRequired && required[dependencyName] !== optional[dependencyName])) {
      throw new Error("Prepared package manifest contains an ambiguous dependency edge");
    }
    return { kind: "optional", ...parsePnpmAuthoredEdge(dependencyName, optional[dependencyName]) };
  }
  const requiredGroups = Number(inRequired) + Number(inDevelopment) + Number(inPeer);
  if (requiredGroups > 1) {
    throw new Error("Prepared package manifest contains an ambiguous dependency edge");
  }
  if (inRequired) {
    return { kind: "required", ...parsePnpmAuthoredEdge(dependencyName, required[dependencyName]) };
  }
  if (inDevelopment) {
    return { kind: "required", ...parsePnpmAuthoredEdge(dependencyName, development[dependencyName]) };
  }
  if (inPeer) {
    return {
      kind: optionalPeerDependency(parentManifest, dependencyName) ? "optional" : "required",
      ...parsePnpmAuthoredEdge(dependencyName, peer[dependencyName]),
    };
  }
  throw new Error("Prepared dependency inventory contains an undeclared logical edge");
}

export { readPnpmPackageManifest, classifyPnpmEdge };
