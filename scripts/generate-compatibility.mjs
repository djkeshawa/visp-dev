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

import { canonicalStringify } from "../src/compatibility-lab.mjs";

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

function component(pkg, version) {
  return {
    commit: pkg.source.commit,
    tree: pkg.source.tree,
    version,
    tarballSha256: pkg.pack.first.sha256
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

  return {
    schemaVersion: 2,
    model: "exact-pair",
    // No pair here corresponds to a registry release. The only Visp versions on
    // npm are visp-kit@0.1.0 and visp-hyper-agent@0.2.0/0.3.0, all deprecated,
    // all predating this matrix. See docs/release-process.md.
    published: false,
    generatedFrom: "evidence/",
    note: "Compatibility is pinned by commit and artifact hash, never by a version range. The same version string can carry different content, and on this project it already does.",
    environment: { operatingSystem: "linux", architecture: "x64", node: "v24.15.0" },
    pairs
  };
}

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
