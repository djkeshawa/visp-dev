/**
 * Measures how a registry version differs from the local package that declares
 * the same version string.
 *
 * A version string is not an identity. `visp-hyper-agent@0.3.0` exists on npm
 * and in the repository, and the two are 34 commits apart. Every compatibility
 * claim in this repository is pinned by commit and artifact hash for exactly
 * that reason, and this module turns the hazard into something measured rather
 * than asserted in prose.
 *
 * Read-only against the registry: it fetches and compares. It never publishes,
 * deprecates, or alters a dist-tag.
 */
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  canonicalStringify,
  createOwnedRoot,
  runProcess,
  sha256Hex
} from "./compatibility-lab.mjs";

const TIMEOUT_MS = 180_000;

async function npmJson(npmCommand, args, cwd) {
  const result = await runProcess(npmCommand, args, { cwd, timeoutMs: TIMEOUT_MS });

  if (result.spawnError || result.timedOut || result.exitCode !== 0) {
    return { ok: false, reason: `${npmCommand} ${args.join(" ")} failed` };
  }

  try {
    return { ok: true, value: JSON.parse(`${result.stdout?.text ?? ""}`) };
  } catch {
    return { ok: false, reason: "registry response was not JSON" };
  }
}

/** Files inside a packed tarball, with a hash per file. */
async function tarballInventory(tarballPath, root) {
  const extracted = path.join(root, "extract");

  await mkdir(extracted, { recursive: true });

  const result = await runProcess("tar", ["xzf", tarballPath, "-C", extracted], {
    timeoutMs: TIMEOUT_MS
  });

  if (result.spawnError || result.exitCode !== 0) return null;

  const base = path.join(extracted, "package");
  const files = {};

  async function walk(directory, prefix) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;

      if (entry.isDirectory()) await walk(absolute, relative);
      else if (entry.isFile()) files[relative] = sha256Hex(await readFile(absolute));
    }
  }

  await walk(base, "");

  return files;
}

function compareInventories(local, published) {
  const localNames = new Set(Object.keys(local));
  const publishedNames = new Set(Object.keys(published));
  const onlyLocal = [...localNames].filter((name) => !publishedNames.has(name)).sort();
  const onlyPublished = [...publishedNames].filter((name) => !localNames.has(name)).sort();
  const differing = [...localNames]
    .filter((name) => publishedNames.has(name) && local[name] !== published[name])
    .sort();
  const identical = [...localNames].filter(
    (name) => publishedNames.has(name) && local[name] === published[name]
  ).length;

  return { onlyLocal, onlyPublished, differing, identical };
}

/**
 * @param input.packageName  registry name, e.g. "visp-hyper-agent"
 * @param input.version      the version string both sides claim
 * @param input.localTarball path to a tarball packed from a local commit
 */
export async function measureDivergence(input) {
  const owned = await createOwnedRoot();

  try {
    const npmCommand = input.npmCommand ?? "npm";
    const spec = `${input.packageName}@${input.version}`;
    const meta = await npmJson(
      npmCommand,
      ["view", spec, "dist.integrity", "dist.tarball", "--json"],
      owned.root
    );

    if (!meta.ok) {
      return { packageName: input.packageName, version: input.version, status: "unavailable", reason: meta.reason };
    }

    const download = await runProcess(npmCommand, ["pack", spec, "--silent"], {
      cwd: owned.root,
      timeoutMs: TIMEOUT_MS
    });

    if (download.spawnError || download.exitCode !== 0) {
      return { packageName: input.packageName, version: input.version, status: "unavailable", reason: "could not download the published tarball" };
    }

    const downloaded = `${download.stdout?.text ?? ""}`.trim().split("\n").at(-1)?.trim();

    if (downloaded === undefined || downloaded.length === 0) {
      return { packageName: input.packageName, version: input.version, status: "unavailable", reason: "npm pack produced no tarball name" };
    }

    const publishedTarball = path.join(owned.root, downloaded);
    const publishedBytes = await readFile(publishedTarball);
    const localBytes = await readFile(input.localTarball);
    const publishedFiles = await tarballInventory(publishedTarball, path.join(owned.root, "published"));
    const localFiles = await tarballInventory(input.localTarball, path.join(owned.root, "local"));

    if (publishedFiles === null || localFiles === null) {
      return { packageName: input.packageName, version: input.version, status: "unavailable", reason: "could not extract a tarball" };
    }

    const comparison = compareInventories(localFiles, publishedFiles);
    const identicalBytes = sha256Hex(localBytes) === sha256Hex(publishedBytes);

    return {
      packageName: input.packageName,
      version: input.version,
      status: identicalBytes ? "identical" : "diverged",
      published: { sha256: sha256Hex(publishedBytes), fileCount: Object.keys(publishedFiles).length },
      local: { sha256: sha256Hex(localBytes), fileCount: Object.keys(localFiles).length },
      comparison
    };
  } finally {
    await import("./compatibility-lab.mjs").then((module) =>
      module.cleanupOwnedRoot({ root: owned.root })
    );
  }
}

export function createDivergenceReport(input) {
  const report = {
    schemaVersion: "visp.registry-divergence.v1",
    note: "A version string is not an identity. This report measures how a published version differs from the local package that declares the same version.",
    environment: { node: process.version, operatingSystem: process.platform, architecture: process.arch },
    packages: [...input.packages].sort((left, right) =>
      `${left.packageName}@${left.version}`.localeCompare(`${right.packageName}@${right.version}`)
    ),
    summary: {
      measured: input.packages.length,
      diverged: input.packages.filter((entry) => entry.status === "diverged").length,
      identical: input.packages.filter((entry) => entry.status === "identical").length,
      unavailable: input.packages.filter((entry) => entry.status === "unavailable").length
    }
  };

  report.reportSha256 = sha256Hex(canonicalStringify(report));

  return JSON.parse(canonicalStringify(report));
}

export function verifyDivergenceReport(report) {
  if (report.schemaVersion !== "visp.registry-divergence.v1") {
    throw new Error("Registry divergence report has an unexpected schema version.");
  }

  const unhashed = structuredClone(report);

  delete unhashed.reportSha256;

  if (report.reportSha256 !== sha256Hex(canonicalStringify(unhashed))) {
    throw new Error("Registry divergence report hash does not match its content.");
  }

  const scratchRoots = new Set();

  for (const entry of report.packages) {
    if (!["diverged", "identical", "unavailable"].includes(entry.status)) {
      throw new Error(`Unknown divergence status for ${entry.packageName}.`);
    }

    if (entry.status !== "unavailable" && entry.local.sha256 === entry.published.sha256) {
      if (entry.status !== "identical") {
        throw new Error(`${entry.packageName} reports diverged but the hashes match.`);
      }
    }

    if (report.packages.length > 1) {
      if (
        typeof entry.scratchRootSha256 !== "string" ||
        !/^[0-9a-f]{64}$/u.test(entry.scratchRootSha256) ||
        scratchRoots.has(entry.scratchRootSha256)
      ) {
        throw new Error("Multi-package divergence evidence requires one distinct owned scratch root per package.");
      }
      scratchRoots.add(entry.scratchRootSha256);
    }
  }

  return true;
}
