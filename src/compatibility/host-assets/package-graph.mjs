/**
 * Building the exact package graph the host-asset runtime is driven against.
 *
 * Two inputs are supported and they are not equivalent. A TARBALL is the
 * artifact a user installs, and it is installed from an offline cache. A
 * REPOSITORY is a working tree, so its whole dependency graph is packed from
 * what is actually resolved on disk and installed offline from those tarballs —
 * otherwise the "offline install" would quietly reach the network for
 * dependencies and prove less than it claims.
 */
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { copyFile, cp, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import { canonicalStringify, sha256Hex } from "../../platform/canonical-json.mjs";
import { inspectInstalledBins } from "../../toolchain/index.mjs";
import { nonEmptyString } from "./manifest.mjs";

const execFileAsync = promisify(execFile);
const INSTALL_FIXTURE_NAME = "visp-host-assets-runtime-install";

function npmEnvironment(cache) {
  return {
    ...process.env,
    npm_config_audit: "false",
    npm_config_cache: cache,
    npm_config_fund: "false",
    npm_config_ignore_scripts: "true",
    npm_config_offline: "true",
    npm_config_update_notifier: "false",
  };
}

export async function copyTarballIntoOwnedRoot(tarballPath, ownedRoot) {
  if (!nonEmptyString(tarballPath)) throw new TypeError("tarballPath must be a non-empty path");
  const source = await realpath(tarballPath);
  if (!(await stat(source)).isFile()) throw new TypeError("tarballPath must identify a file");
  const destination = path.join(ownedRoot, "visp-hyper-agent-input.tgz");
  await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
  return destination;
}

export async function packRepository(repositoryRoot, ownedRoot, npmCommand) {
  if (!nonEmptyString(repositoryRoot)) {
    throw new TypeError("repositoryRoot must be a non-empty path");
  }
  const repository = await realpath(repositoryRoot);
  const packageJson = JSON.parse(await readFile(path.join(repository, "package.json"), "utf8"));
  if (packageJson.name !== "visp-hyper-agent") {
    throw new TypeError("repositoryRoot must identify visp-hyper-agent");
  }
  const output = path.join(ownedRoot, "repository pack");
  const cache = path.join(ownedRoot, "repository pack cache");
  await mkdir(output);
  await mkdir(cache);
  try {
    await execFileAsync(npmCommand, ["pack", "--ignore-scripts", "--pack-destination", output], {
      cwd: repository,
      encoding: "utf8",
      env: npmEnvironment(cache),
      maxBuffer: 2 * 1024 * 1024,
      timeout: 60_000,
    });
  } catch {
    throw new Error("Packing the Hyper repository failed; build it first and ensure npm is available");
  }
  const packed = (await readdir(output)).filter((entry) => entry.endsWith(".tgz"));
  if (packed.length !== 1) throw new Error("npm pack did not produce exactly one Hyper tarball");
  return path.join(output, packed[0]);
}

function dependencyNames(manifest) {
  return [...new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ])].sort();
}

/** Where a dependency actually resolved, including pnpm's linked layouts. */
async function resolveDependency(ownerManifestPath, ownerRoot, dependency) {
  const direct = path.join(ownerRoot, "node_modules", ...dependency.split("/"));
  try {
    if ((await stat(path.join(direct, "package.json"))).isFile()) return await realpath(direct);
  } catch {
    // Fall through to Node resolution for pnpm and other linked layouts.
  }
  const require = createRequire(ownerManifestPath);
  try {
    return path.dirname(require.resolve(`${dependency}/package.json`));
  } catch {
    const entry = require.resolve(dependency);
    let current = path.dirname(entry);
    while (true) {
      try {
        const manifest = JSON.parse(await readFile(path.join(current, "package.json"), "utf8"));
        if (manifest.name === dependency) return current;
      } catch {
        // Continue walking toward the resolved package root.
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw new Error(`Installed dependency is unavailable: ${dependency}`);
}

export async function packRepositoryDependencies(repositoryRoot, ownedRoot, npmCommand) {
  const repository = await realpath(repositoryRoot);
  const rootManifestPath = path.join(repository, "package.json");
  const rootManifest = JSON.parse(await readFile(rootManifestPath, "utf8"));
  const packRoot = path.join(ownedRoot, "dependency packs");
  const packCacheRoot = path.join(ownedRoot, "dependency pack cache");
  const stagingRoot = path.join(ownedRoot, "dependency staging");
  await mkdir(packRoot);
  await mkdir(packCacheRoot);
  await mkdir(stagingRoot);

  const queue = [{ manifest: rootManifest, manifestPath: rootManifestPath, packageRoot: repository }];
  const packed = new Set();
  const tarballs = [];
  while (queue.length > 0) {
    const owner = queue.shift();
    for (const dependency of dependencyNames(owner.manifest)) {
      const resolved = await resolveDependency(owner.manifestPath, owner.packageRoot, dependency);
      const manifestPath = path.join(resolved, "package.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const identity = `${manifest.name}@${manifest.version}`;
      if (packed.has(identity)) continue;
      packed.add(identity);
      const staged = path.join(stagingRoot, sha256Hex(identity).slice(0, 16));
      await cp(resolved, staged, {
        dereference: true,
        errorOnExist: true,
        force: false,
        recursive: true,
      });
      const before = new Set(await readdir(packRoot));
      try {
        await execFileAsync(npmCommand, ["pack", "--ignore-scripts", "--pack-destination", packRoot], {
          cwd: staged,
          encoding: "utf8",
          env: npmEnvironment(packCacheRoot),
          maxBuffer: 2 * 1024 * 1024,
          timeout: 60_000,
        });
      } catch {
        throw new Error(`Could not pack installed dependency ${identity}`);
      }
      const created = (await readdir(packRoot))
        .filter((entry) => entry.endsWith(".tgz") && !before.has(entry));
      if (created.length !== 1) {
        throw new Error(`Packing ${identity} did not produce exactly one dependency tarball`);
      }
      tarballs.push({
        name: manifest.name,
        tarball: path.join(packRoot, created[0]),
        version: manifest.version,
      });
      queue.push({ manifest, manifestPath, packageRoot: resolved });
    }
  }

  const names = new Set();
  for (const dependency of tarballs) {
    if (names.has(dependency.name)) {
      throw new Error(`Repository dependency graph contains multiple versions of ${dependency.name}`);
    }
    names.add(dependency.name);
  }
  return tarballs;
}

export async function installRepositoryPackageGraph({
  dependencyTarballs,
  fixtureRoot,
  hyperTarball,
  npmCommand,
}) {
  await mkdir(fixtureRoot);
  const cache = path.join(fixtureRoot, ".npm-cache");
  await mkdir(cache);
  const dependencies = { "visp-hyper-agent": `file:${hyperTarball}` };
  for (const dependency of dependencyTarballs) {
    dependencies[dependency.name] = `file:${dependency.tarball}`;
  }
  await writeFile(
    path.join(fixtureRoot, "package.json"),
    canonicalStringify({ name: INSTALL_FIXTURE_NAME, private: true, dependencies }),
    { flag: "wx", mode: 0o600 },
  );
  try {
    await execFileAsync(
      npmCommand,
      [
        "install",
        "--offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        "--omit=dev",
        "--cache",
        cache,
      ],
      {
        cwd: fixtureRoot,
        encoding: "utf8",
        env: npmEnvironment(cache),
        maxBuffer: 2 * 1024 * 1024,
        timeout: 60_000,
      },
    );
  } catch {
    throw new Error("Offline local dependency-graph install failed");
  }
  const installed = [];
  for (const name of Object.keys(dependencies).sort()) {
    const manifest = JSON.parse(await readFile(
      path.join(fixtureRoot, "node_modules", ...name.split("/"), "package.json"),
      "utf8",
    ));
    if (manifest.name !== name || !nonEmptyString(manifest.version)) {
      throw new Error(`Installed dependency identity differs for ${name}`);
    }
    installed.push({ name, version: manifest.version });
  }
  const tree = { dependencies: installed, name: INSTALL_FIXTURE_NAME };
  return {
    bins: await inspectInstalledBins({ fixtureRoot }),
    cache: {
      inventorySha256: sha256Hex(canonicalStringify(
        dependencyTarballs.map(({ name, version }) => ({ name, version })),
      )),
      mode: "repository_local_tarballs",
    },
    dependencyTree: { sha256: sha256Hex(canonicalStringify(tree)), tree },
    lifecycleScriptsDisabled: true,
    offline: true,
    tool: { name: "npm", version: null },
  };
}
