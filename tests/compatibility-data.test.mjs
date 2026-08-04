import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { buildCompatibility } from "../scripts/generate-compatibility.mjs";
import { PHASE_6_COMPATIBILITY_DEFINITION } from "../src/phase-6-compatibility.mjs";

const matrix = JSON.parse(readFileSync(new URL("../compatibility.json", import.meta.url), "utf8"));

test("compatibility.json is derived from the committed evidence, not hand-maintained", async () => {
  const built = await buildCompatibility();
  assert.deepEqual(matrix, JSON.parse(JSON.stringify(built)));
});

test("every pair is pinned by commit and artifact hash, never by a version range", () => {
  assert.equal(matrix.model, "exact-pair");
  for (const pair of matrix.pairs) {
    for (const side of ["kit", "hyper"]) {
      assert.match(pair[side].commit, /^[0-9a-f]{40}$/u, `${pair.id} ${side} commit`);
      assert.match(pair[side].tree, /^[0-9a-f]{40}$/u, `${pair.id} ${side} tree`);
      assert.match(pair[side].tarballSha256, /^[0-9a-f]{64}$/u, `${pair.id} ${side} tarball`);
    }
    assert.match(pair.schemaHash, /^sha256:[0-9a-f]{64}$/u, `${pair.id} schema hash`);
    assert.match(pair.evidenceSha256, /^[0-9a-f]{64}$/u, `${pair.id} evidence hash`);
  }
});

test("the matrix records the release without letting a pair assert a version", () => {
  // Registry existence is a separate fact from support. When the evidenced
  // pair has been superseded on the registry, no release is recommended —
  // proof of an older pair is not a reason to install it.
  assert.equal(matrix.published, true);
  if (matrix.registryState?.supersedesEvidencedPair === true) {
    assert.equal(matrix.supportedRelease, null);
  } else {
    assert.match(matrix.supportedRelease.kit, /^\d+\.\d+\.\d+$/u);
    assert.match(matrix.supportedRelease.hyper, /^\d+\.\d+\.\d+$/u);
  }

  // The part that has not changed and must not: an individual pair still carries
  // no version. Proof attaches to a commit and a tarball hash, never to a
  // version number, and a published release does not alter that.
  for (const pair of matrix.pairs) {
    assert.equal(pair.kit.version, null, `${pair.id} kit version must not assert a release`);
    assert.equal(pair.hyper.version, null, `${pair.id} hyper version must not assert a release`);
  }
});

test("the newest pair is the exact pair npm serves", () => {
  const pair = matrix.pairs.at(-1);
  const { kitFixed, hyperCurrent } = PHASE_6_COMPATIBILITY_DEFINITION.packages;

  assert.equal(pair.id, "phase-6");
  assert.deepEqual(
    {
      commit: pair.kit.commit,
      tarballSha256: pair.kit.tarballSha256,
      tree: pair.kit.tree
    },
    {
      commit: kitFixed.commit,
      tarballSha256: kitFixed.tarballSha256,
      tree: kitFixed.tree
    }
  );
  assert.deepEqual(
    {
      commit: pair.hyper.commit,
      tarballSha256: pair.hyper.tarballSha256,
      tree: pair.hyper.tree
    },
    {
      commit: hyperCurrent.commit,
      tarballSha256: hyperCurrent.tarballSha256,
      tree: hyperCurrent.tree
    }
  );
  // The evidence still resolves to the exact packages it proved, whether or
  // not that pair is currently recommended.
  assert.equal(matrix.releaseEvidence.resolvedPackages.kit.version, kitFixed.version);
  assert.equal(matrix.releaseEvidence.resolvedPackages.hyper.version, hyperCurrent.version);
  if (matrix.supportedRelease !== null) {
    assert.equal(matrix.supportedRelease.kit, kitFixed.version);
    assert.equal(matrix.supportedRelease.hyper, hyperCurrent.version);
  }
});

test("a superseded registry state withholds the recommendation and names the hazard", () => {
  const registry = matrix.registryState;
  assert.ok(registry, "the matrix must record what the registries serve");
  if (registry.supersedesEvidencedPair !== true) return;

  // Withheld, not falsified: the older pair's evidence stays eligible.
  assert.equal(matrix.supportedRelease, null);
  assert.equal(matrix.releaseEvidence.eligible, true);
  // The hazard must be concrete enough to act on, not a shrug.
  assert.match(registry.hazard, /visp-kit@[\d.]+/u);
  assert.match(registry.hazard, /visp-hyper-agent@[\d.]+/u);
  assert.match(registry.npm["visp-kit"], /^\d+\.\d+\.\d+$/u);
  assert.match(registry.npm["visp-hyper-agent"], /^\d+\.\d+\.\d+$/u);
});

test("each pair names the evidence file that proves it", () => {
  for (const pair of matrix.pairs) {
    assert.match(pair.evidence, /^evidence\/.+\.json$/u);
    const evidence = JSON.parse(
      readFileSync(new URL(`../${pair.evidence}`, import.meta.url), "utf8")
    );
    assert.equal(evidence.reportSha256, pair.evidenceSha256, `${pair.id} evidence hash matches`);
    assert.equal(evidence.schemaHash, pair.schemaHash, `${pair.id} schema hash matches`);
  }
});
