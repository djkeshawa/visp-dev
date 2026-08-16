/**
 * A package manifest's identity, read the way npm reads it.
 *
 * Split out from `npm-pack.mjs` so that `lockfile/npm.mjs` can compare a lock
 * entry's bin metadata against a packed manifest without importing the packer,
 * which imports the lockfile modules in turn.
 */
import path from "node:path";

import { plainObject } from "../platform/shape.mjs";
import { compareText } from "./process.mjs";

/**
 * Declared bins, normalised to a sorted `{ name, path }` list.
 *
 * The string form of `bin` names the command after the package, and for a
 * scoped package that is the part after the slash — `@scope/thing` installs
 * `thing`. Getting that wrong means comparing a lock entry against a command
 * the package never installs.
 */
export function normalizeBins(packageJson) {
  if (packageJson.bin === undefined) return [];
  let bins;
  if (typeof packageJson.bin === "string") {
    const shortName = packageJson.name.startsWith("@") ? packageJson.name.split("/")[1] : packageJson.name;
    bins = { [shortName]: packageJson.bin };
  } else {
    plainObject(packageJson.bin, "package.json bin");
    bins = packageJson.bin;
  }
  return Object.entries(bins)
    .map(([name, binPath]) => {
      if (typeof binPath !== "string" || binPath.length === 0) throw new TypeError(`Invalid declared bin path for ${name}`);
      return { name, path: binPath.replaceAll(path.sep, "/") };
    })
    .sort((left, right) => compareText(left.name, right.name));
}

export function packageIdentity(packageJson) {
  if (typeof packageJson.name !== "string" || typeof packageJson.version !== "string") {
    throw new Error("package.json must declare string name and version fields");
  }
  return { name: packageJson.name, version: packageJson.version, declaredBins: normalizeBins(packageJson) };
}
