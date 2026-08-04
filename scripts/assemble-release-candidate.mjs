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
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

import {
  canonicalStringify,
  cleanupOwnedRoot,
  createOwnedRoot,
  packPackageTwice,
  sha256Hex
} from "../src/compatibility-lab.mjs";


/**
 * Download exactly what the registry serves and digest it. Nothing here trusts
 * the registry's own reported hash: npm's `dist.integrity` is the registry's
 * claim about its bytes, and the point of this check is to compare OUR bytes to
 * THEIR bytes independently.
 */
async function registryTarballDigest({ manifest, npmCommand, scratchRoot }) {
  const spec = `${manifest.name}@${manifest.version}`;
  const url = execFileSync(npmCommand, ["view", spec, "dist.tarball"], {
    stdio: ["ignore", "pipe", "ignore"]
  })
    .toString()
    .trim();
  if (!/^https:\/\/[^\s]+\.tgz$/u.test(url)) {
    throw new Error(`Registry returned an unusable tarball URL for ${spec}: ${url}`);
  }
  const scratch = await mkdtemp(path.join(scratchRoot, "registry-compare-"));
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Downloading ${spec} failed with HTTP ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return createHash("sha256").update(bytes).digest("hex");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

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
    else if (flag === "--released") input.released = true;
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

      // Two different questions, and they need different answers.
      //
      // PRE-PUBLICATION (default): never assemble a candidate whose version
      // already exists. A published version number is immutable content, and a
      // candidate that shadows one is a mistake waiting to be uploaded.
      //
      // POST-PUBLICATION (--released): the pair is already on the registry and
      // we want evidence ABOUT what it serves. Refusing here would be the wrong
      // answer to the right question; claiming "assembled_not_published" about
      // published artifacts would be a false statement inside an evidence
      // record. So we assert something stronger and PROVE it: the bytes we
      // packed from this commit are byte-identical to the bytes the registry
      // serves. If they differ, this source does not reproduce the published
      // artifact and the run fails — that divergence is exactly what an
      // evidence tool exists to catch.
      let registryTarballSha256 = null;
      if (published !== null) {
        if (!input.released) {
          throw new Error(
            `${manifest.name}@${manifest.version} already exists on the registry; bump before assembling, ` +
              "or pass --released to record evidence about the published artifact instead"
          );
        }
        registryTarballSha256 = await registryTarballDigest({
          manifest,
          npmCommand: input.npmCommand,
          scratchRoot: input.offlineStoreSource
        });
        if (registryTarballSha256 !== packed.first.sha256) {
          throw new Error(
            `${manifest.name}@${manifest.version} does not reproduce: this commit packs ` +
              `${packed.first.sha256} but the registry serves ${registryTarballSha256}. ` +
              "The published artifact was not built from this source."
          );
        }
      } else if (input.released) {
        throw new Error(
          `--released was passed but ${manifest.name}@${manifest.version} is not on the registry. ` +
            "Assemble a candidate without --released, or publish first."
        );
      }

      artifacts.push({
        name: manifest.name,
        version: manifest.version,
        commit,
        tree: git(target.repositoryPath, ["rev-parse", "HEAD^{tree}"]),
        tarballSha256: packed.first.sha256,
        byteIdenticalOnRepack: packed.first.sha256 === packed.second.sha256,
        ...(registryTarballSha256 === null
          ? {}
          : { registryTarballSha256, byteIdenticalToRegistry: true })
      });
    }

    const released = input.released === true;
    const report = {
      // v2 exists so a report can describe a PUBLISHED pair without lying about
      // it. v1 reports remain valid and are still verified; they simply cannot
      // express this state.
      schemaVersion: released ? "visp.release-candidate.v2" : "visp.release-candidate.v1",
      status: released ? "released_and_byte_identical" : "assembled_not_published",
      note: released
        ? "Evidence about an ALREADY PUBLISHED pair. Every artifact below was packed from the named commit and independently verified byte-identical to the tarball the registry serves. This tool has no registry write path."
        : "A release candidate. Nothing here has been published, and this tool has no registry write path.",
      environment: { node: process.version, operatingSystem: process.platform, architecture: process.arch },
      artifacts: artifacts.sort((left, right) => left.name.localeCompare(right.name)),
      knownLimitations: [
        "A supported release is already published. Everything this candidate supersedes stays on the registry, including the deprecated visp-kit@0.1.0 and visp-hyper-agent@0.2.0/0.3.0, because a published version can never be replaced.",
        "Compatibility is exact-pair only, pinned by commit and artifact hash. No version range is supported.",
        "Committed evidence was produced on Linux x64 with Node 24. The CI matrix covers macOS and Windows; the evidence reports do not.",
        "Assurance verdicts are inconclusive because oracle-result mapping is incomplete. inconclusive is never a pass.",
        "No performance or review-efficiency claim is made; the Phase 6 evaluation gates have not run.",
        "Dogfooding covers one real repository across three runs. That is real use, not a broad sample."
      ],
      ...(released
        ? {
            // A published pair has no publication preconditions left; stating
            // them would imply an upload that already happened.
            registryVerification: [
              "Each artifact's tarball was downloaded from the registry and digested independently; the registry's own reported integrity was not trusted as the comparison.",
              "A mismatch fails this assembly rather than being recorded, because a source that does not reproduce the published artifact is the defect this check exists to find."
            ]
          }
        : {}),
      publicationPreconditions: released
        ? ["Not applicable: these artifacts are already published."]
        : [
        "The publication freeze is lifted (D-069 by D-097), and this registry action has its own explicit recorded decision — the per-action requirement outlived the freeze.",
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
