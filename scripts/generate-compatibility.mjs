#!/usr/bin/env node
/**
 * Generates compatibility.json from the committed evidence.
 *
 * The matrix is derived, never hand-maintained. A hand-written copy drifts from
 * the evidence it claims to summarise, and a stale list that still looks
 * authoritative is the defect that let two pages ship with broken heading order
 * in dogfooding run 1. Run with --check in CI to fail on drift.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { canonicalStringify, sha256Hex } from "../src/compatibility-lab.mjs";
import { evaluateReleaseEvidence } from "../src/release-evidence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Each entry names the evidence file, the pair inside it that represents the
 * phase's accepted end state, and the protocol that pair negotiated.
 */
const SOURCES = [
  {
    id: "phase-2",
    evidence: "evidence/phase-2-packed-linux-x64-node24.json",
    kit: "kit",
    hyper: "hyper",
    negotiated: "3.1"
  },
  {
    id: "phase-3",
    evidence: "evidence/phase-3-packed-linux-x64-node24.json",
    kit: "kitNew",
    hyper: "hyperNew",
    negotiated: "3.2"
  },
  {
    id: "phase-4",
    evidence: "evidence/phase-4-pair-linux-x64-node24.json",
    kit: "kitNew",
    hyper: "hyperNew",
    negotiated: "3.2"
  }
];

async function readJson(relative) {
  return JSON.parse(await readFile(path.join(root, relative), "utf8"));
}

async function readEvidence(relative) {
  const bytes = await readFile(path.join(root, relative));

  return { fileSha256: sha256Hex(bytes), report: JSON.parse(bytes.toString("utf8")) };
}

function component(pkg, version) {
  const source = pkg.source ?? pkg;
  const tarballSha256 = pkg.pack?.first?.sha256 ?? pkg.tarballSha256;

  if (
    typeof source.commit !== "string" ||
    typeof source.tree !== "string" ||
    typeof tarballSha256 !== "string"
  ) {
    throw new Error("Compatibility evidence package identity is incomplete");
  }

  return {
    commit: source.commit,
    tree: source.tree,
    version,
    tarballSha256
  };
}

export async function buildCompatibility() {
  const pairs = [];

  for (const source of SOURCES) {
    const evidence = await readJson(source.evidence);
    const kit = evidence.packages[source.kit];
    const hyper = evidence.packages[source.hyper];

    if (kit === undefined || hyper === undefined) {
      throw new Error(`${source.evidence} is missing ${source.kit} or ${source.hyper}`);
    }

    pairs.push({
      id: source.id,
      kit: component(kit, null),
      hyper: component(hyper, null),
      workflowActionProtocols: ["2.0", "3.0", "3.1", "3.2"],
      negotiated: source.negotiated,
      schemaHash: evidence.schemaHash,
      node: ">=22",
      evidence: source.evidence,
      evidenceSha256: evidence.reportSha256
    });
  }

  const evidence = {
    candidate: await readEvidence("evidence/release-candidate-linux-x64-node24.json"),
    darwin: await readEvidence("evidence/conformance-fixtures-darwin-arm64-node24.json"),
    linux: await readEvidence("evidence/conformance-fixtures-linux-x64-node24.json"),
    phase6: await readEvidence("evidence/phase-6-pair-linux-x64-node24.json"),
    platformProvenance: await readEvidence("evidence/conformance-fixtures-run-30686678616.json")
  };
  const releaseEvidence = evaluateReleaseEvidence({
    candidate: evidence.candidate.report,
    darwin: evidence.darwin.report,
    darwinFileSha256: evidence.darwin.fileSha256,
    linux: evidence.linux.report,
    linuxFileSha256: evidence.linux.fileSha256,
    phase6: evidence.phase6.report,
    phase6FileSha256: evidence.phase6.fileSha256,
    platformProvenance: evidence.platformProvenance.report
  });

  if (releaseEvidence.eligible) {
    const phase6 = evidence.phase6.report;

    pairs.push({
      id: "phase-6",
      kit: component(phase6.packages.kitFixed, null),
      hyper: component(phase6.packages.hyperCurrent, null),
      workflowActionProtocols: ["2.0", "3.0", "3.1", "3.2"],
      negotiated: "3.2",
      schemaHash: phase6.schemaHash,
      node: ">=22",
      evidence: "evidence/phase-6-pair-linux-x64-node24.json",
      evidenceSha256: phase6.reportSha256
    });
  }

  return {
    schemaVersion: 2,
    model: "exact-pair",
    // Registry existence is a separate fact from support. The release is
    // recommended only when the shared fail-closed evaluator accepts the exact
    // candidate, genuine packed Phase 6 report, and same-run platform reports.
    published: true,
    supportedRelease: releaseEvidence.eligible
      ? { kit: releaseEvidence.expectedPackages.kit.version, hyper: releaseEvidence.expectedPackages.hyper.version }
      : null,
    releaseEvidence: {
      eligible: releaseEvidence.eligible,
      issues: releaseEvidence.issues,
      platformRunIdentity: releaseEvidence.platformRunIdentity,
      resolvedPackages: releaseEvidence.resolvedPackages
    },
    generatedFrom: "evidence/",
    // Versions that exist on the registry and must never be used. Recorded here
    // so tooling can warn rather than relying on a human to remember, and so
    // doctor can name the specific build a user already has installed.
    deprecated: [
      { name: "visp-kit", version: "0.1.0", reason: "Predates the enforcement-hole fixes." },
      { name: "visp-hyper-agent", version: "0.2.0", reason: "Superseded and unsupported." },
      {
        name: "visp-hyper-agent",
        version: "0.3.0",
        reason: "Documents an install path pointing at an unrelated third-party package."
      }
    ],
    note: "Compatibility is pinned by commit and artifact hash, never by a version range. The same version string can carry different content, and on this project it already does.",
    environment: { operatingSystem: "linux", architecture: "x64", node: "v24.15.0" },
    pairs
  };
}

// Only when invoked as a command. This body used to run on import, and
// `tests/compatibility-data.test.mjs` imports `buildCompatibility` — so merely
// loading the module rewrote a tracked file, taking the `else` branch because
// the test runner's argv has no `--check`.
//
// `node --test` runs each file in its own process, so that write raced
// `tests/cli.test.mjs` reading the same path. `writeFile` truncates before it
// writes, and a read landing in that window returned "". CI failed with
// `Unexpected end of JSON input` from `readCompatibility`, which reads as
// corrupt data rather than as two tests fighting over a file.
if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const target = path.join(root, "compatibility.json");
  const built = `${canonicalStringify(await buildCompatibility())}\n`;

  if (process.argv.includes("--check")) {
    let current;

    try {
      current = await readFile(target, "utf8");
    } catch {
      process.stderr.write("compatibility.json is missing. Run: npm run compatibility:generate\n");
      process.exit(1);
    }

    if (current !== built) {
      process.stderr.write(
        "compatibility.json is stale relative to evidence/. Run: npm run compatibility:generate\n"
      );
      process.exit(1);
    }

    process.stdout.write("compatibility.json matches the committed evidence.\n");
  } else {
    await writeFile(target, built);
    process.stdout.write(`Wrote ${path.relative(root, target)}\n`);
  }
}
