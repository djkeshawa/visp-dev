#!/usr/bin/env node
/**
 * Assembles a release candidate. Packs from exact local commits, records every
 * hash, and produces the changelog and known limitations.
 *
 * It publishes nothing. There is no registry code path in this file at all,
 * which is deliberate: an assembler that *could* publish is one flag away from
 * doing so, and the freeze is currently the only thing standing between the
 * project and shipping an unreviewed build.
 */
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  canonicalStringify,
  cleanupOwnedRoot,
  createOwnedRoot,
  packPackageTwice,
  sha256Hex
} from "../src/compatibility-lab.mjs";

function parseArguments(argv) {
  const input = { targets: [] };
  let outputPath = null;
  const take = (index, flag) => {
    if (index + 1 >= argv.length) throw new TypeError(`${flag} requires a value`);
    return argv[index + 1];
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--repository") {
      const [name, repositoryPath] = take(index++, flag).split("=");
      if (!name || !repositoryPath) throw new TypeError("--repository expects <name>=<path>");
      input.targets.push({ name, repositoryPath });
    } else if (flag === "--offline-store") input.offlineStoreSource = take(index++, flag);
    else if (flag === "--package-manager") input.packageManagerCommand = take(index++, flag);
    else if (flag === "--npm") input.npmCommand = take(index++, flag);
    else if (flag === "--output") outputPath = take(index++, flag);
    else throw new TypeError(`Unknown argument: ${flag}`);
  }
  if (input.targets.length === 0) throw new TypeError("At least one --repository is required");
  for (const field of ["offlineStoreSource", "packageManagerCommand", "npmCommand"]) {
    if (!input[field]) throw new TypeError(`Missing required argument: ${field}`);
  }
  return { input, outputPath };
}

const git = (repositoryPath, args) =>
  execFileSync("git", ["-C", repositoryPath, ...args]).toString().trim();

try {
  const { input, outputPath } = parseArguments(process.argv.slice(2));
  const owned = await createOwnedRoot();

  try {
    const artifacts = [];

    for (const target of input.targets) {
      const manifest = JSON.parse(
        await readFile(path.join(target.repositoryPath, "package.json"), "utf8")
      );
      const commit = git(target.repositoryPath, ["rev-parse", "HEAD"]);
      const dirty = git(target.repositoryPath, ["status", "--porcelain"]).length > 0;

      // A candidate packed from a dirty tree is not identified by its commit,
      // and the whole compatibility model rests on that identification.
      if (dirty) throw new Error(`${target.name} has uncommitted changes; cannot assemble a candidate`);

      // Each package needs its own scratch root; packPackageTwice materialises
      // a snapshot inside it and two packages sharing one root collide.
      const packageRoot = await createOwnedRoot({ baseDirectory: owned.root });
      const packed = await packPackageTwice({
        repositoryRoot: target.repositoryPath,
        commit,
        ownedRoot: packageRoot.root,
        offlineStoreSource: input.offlineStoreSource,
        packageManagerCommand: input.packageManagerCommand,
        npmCommand: input.npmCommand
      });

      const published = (() => {
        try {
          return execFileSync(input.npmCommand, ["view", `${manifest.name}@${manifest.version}`, "version"], {
            stdio: ["ignore", "pipe", "ignore"]
          }).toString().trim();
        } catch {
          return null;
        }
      })();

      // Never assemble a candidate whose version already exists: a published
      // version number is immutable content.
      if (published !== null) {
        throw new Error(
          `${manifest.name}@${manifest.version} already exists on the registry; bump before assembling`
        );
      }

      artifacts.push({
        name: manifest.name,
        version: manifest.version,
        commit,
        tree: git(target.repositoryPath, ["rev-parse", "HEAD^{tree}"]),
        tarballSha256: packed.first.sha256,
        byteIdenticalOnRepack: packed.first.sha256 === packed.second.sha256
      });
    }

    const report = {
      schemaVersion: "visp.release-candidate.v1",
      status: "assembled_not_published",
      note: "A release candidate. Nothing here has been published, and this tool has no registry write path.",
      environment: { node: process.version, operatingSystem: process.platform, architecture: process.arch },
      artifacts: artifacts.sort((left, right) => left.name.localeCompare(right.name)),
      knownLimitations: [
        "A supported release is already published. Every version this candidate supersedes stays on the registry, because a published version can never be replaced.",
        "Compatibility is exact-pair only, pinned by commit and artifact hash. No version range is supported.",
        "Committed evidence was produced on Linux x64 with Node 24. The CI matrix covers macOS and Windows; the evidence reports do not.",
        "Assurance verdicts are inconclusive because oracle-result mapping is incomplete. inconclusive is never a pass.",
        "No performance or review-efficiency claim is made; the Phase 6 evaluation gates have not run.",
        "Dogfooding covers one real repository across three runs. That is real use, not a broad sample."
      ],
      publicationPreconditions: [
        "This registry action has its own explicit recorded decision. The D-069 freeze was lifted by D-097; the per-action requirement outlived it.",
        "Every artifact SHA-256 above is re-verified immediately before upload.",
        "The disposition of the versions this candidate supersedes is decided and executed.",
        "An SBOM exists for each artifact, regenerated on the machine doing the release."
      ]
    };

    report.reportSha256 = sha256Hex(canonicalStringify(report));

    if (outputPath !== null) {
      await writeFile(outputPath, canonicalStringify(report), { flag: "wx", mode: 0o600 });
    }

    process.stdout.write(`${canonicalStringify(report)}\n`);
  } finally {
    await cleanupOwnedRoot({ root: owned.root });
  }
} catch (error) {
  process.stderr.write(`release-candidate: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
