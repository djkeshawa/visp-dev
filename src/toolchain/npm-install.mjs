/**
 * Installing a packed tarball offline, and running what it installed.
 *
 * The install fixture is an owned temporary root with an empty or
 * caller-supplied cache and no network. Installed bins are read through
 * `realpath` and refused if they resolve outside the fixture — an installed
 * command pointing at the host would be measuring the host.
 */
import { access, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import process from "node:process";

import { canonicalStringify, sha256Hex } from "../platform/canonical-json.mjs";
import {
  DEFAULT_TIMEOUT_MS,
  findExecutable,
  runChecked,
  runProcess,
  stableEnvironment,
  trimLine,
} from "./process.mjs";
import { findOwnedRoot, isWithin, requireOwnedPath } from "./owned-root.mjs";
import { npmEnvironment, prepareOfflineCache } from "./npm-environment.mjs";
import { readPackedManifest } from "./npm-pack.mjs";
import { installedDependencyTree, prepareOfflineInstallLock } from "./lockfile/npm.mjs";
import { verifyInstalledLockGraph } from "./lockfile/graph.mjs";

export async function inspectInstalledBins({ fixtureRoot }) {
  const fixture = await realpath(fixtureRoot);
  const owned = await findOwnedRoot(fixture);
  if (!owned) throw new Error("fixtureRoot must be inside a laboratory-owned temporary root");
  const binDirectory = path.join(fixture, "node_modules", ".bin");
  let names;
  try {
    names = (await readdir(binDirectory)).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const bins = [];
  for (const name of names) {
    const binPath = path.join(binDirectory, name);
    const entry = await lstat(binPath);
    if (!entry.isFile() && !entry.isSymbolicLink()) throw new Error(`Installed bin ${name} is not executable content`);
    const target = await realpath(binPath);
    if (!isWithin(fixture, target)) throw new Error(`Installed bin ${name} resolves outside install fixture`);
    const bytes = await readFile(target);
    bins.push({ name, sha256: sha256Hex(bytes), target: path.relative(fixture, target).split(path.sep).join("/") });
  }
  return bins;
}

export async function installLocalTarball({
  tarballPath,
  fixtureRoot,
  npmCommand = "npm",
  offlineCacheSource,
  offlineInstallLockSource,
}) {
  const { absolute: tarball } = await requireOwnedPath(tarballPath, "tarballPath");
  const { absolute: fixture } = await requireOwnedPath(fixtureRoot, "fixtureRoot");
  await access(tarball, fsConstants.R_OK);
  const npmExecutable = await findExecutable(npmCommand);
  if (!npmExecutable) throw new Error("Offline installer unavailable");
  await mkdir(fixture, { recursive: false });
  const packedManifest = await readPackedManifest(tarball);
  const localDependency = `file:${tarball}`;
  await writeFile(path.join(fixture, "package.json"), canonicalStringify({
    name: "visp-compatibility-install",
    private: true,
    ...(offlineInstallLockSource === undefined ? {} : { dependencies: { [packedManifest.name]: localDependency } }),
  }));
  const cachePath = path.join(fixture, ".npm-cache");
  const cache = await prepareOfflineCache(offlineCacheSource, cachePath);
  const environment = await npmEnvironment({
    executables: [npmExecutable],
    configurationDirectory: path.join(fixture, ".npm-config"),
    cacheDirectory: cachePath,
    ignoreScripts: true,
  });
  const installLock = offlineInstallLockSource === undefined
    ? null
    : await prepareOfflineInstallLock({
      source: offlineInstallLockSource,
      target: path.join(fixture, "package-lock.json"),
      tarballPath: tarball,
      packageJson: packedManifest,
    });
  const installArguments = installLock === null
    ? [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--omit=dev",
      "--cache",
      cachePath,
      tarball,
    ]
    : [
      "ci",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--omit=dev",
      "--cache",
      cachePath,
    ];
  const result = await runProcess(
    npmExecutable,
    installArguments,
    { cwd: fixture, env: environment, timeoutMs: 60_000 },
  );
  if (result.spawnError) throw new Error("Offline installer unavailable");
  if (result.timedOut || result.exitCode !== 0) {
    const error = new Error("Offline local-tarball install failed");
    error.code = "OFFLINE_INSTALL_FAILED";
    error.observation = result;
    throw error;
  }
  await verifyInstalledLockGraph(fixture, installLock);
  const versionResult = await runChecked(npmExecutable, ["--version"], { env: environment }, "Installer version");
  return {
    bins: await inspectInstalledBins({ fixtureRoot: fixture }),
    cache,
    dependencyTree: await installedDependencyTree(npmExecutable, fixture, environment),
    installLock,
    lifecycleScriptsDisabled: true,
    offline: true,
    tool: { name: "npm", version: trimLine(versionResult.stdout) },
  };
}

export async function runInstalledBin({ fixtureRoot, binName, args = [], timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (typeof binName !== "string" || !/^[A-Za-z0-9._-]+$/.test(binName)) throw new TypeError("binName must be a simple installed bin name");
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) throw new TypeError("args must be an array of strings");
  const fixture = await realpath(fixtureRoot);
  const bins = await inspectInstalledBins({ fixtureRoot: fixture });
  if (!bins.some(({ name }) => name === binName)) throw new Error(`Installed bin not found: ${binName}`);
  const binDirectory = path.join(fixture, "node_modules", ".bin");
  const executable = path.join(binDirectory, binName);
  const ownedRoot = await findOwnedRoot(fixture);
  const result = await runProcess(executable, args, {
    cwd: fixture,
    env: stableEnvironment([process.execPath], binDirectory),
    // The owned root is a fresh random name every run. Output carrying it is
    // output that cannot be compared between runs, so it fails rather than
    // silently producing an unstable observation.
    forbiddenOutputFragments: [ownedRoot],
    timeoutMs,
  });
  if (result.spawnError) {
    const error = new Error("Installed binary could not be executed");
    error.code = "EXECUTION_SPAWN_FAILED";
    throw error;
  }
  if (result.forbiddenOutputDetected) {
    const error = new Error("Execution output contains a laboratory-owned temporary path");
    error.code = "UNSTABLE_EXECUTION_OUTPUT";
    error.observation = result;
    throw error;
  }
  return result;
}
