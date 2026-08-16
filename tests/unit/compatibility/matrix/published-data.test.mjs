/**
 * Test 1 — "compatibility.json is derived from the committed evidence, not
 * hand-maintained" — is deleted with the generator it called. The file is now
 * hand-maintained on purpose, so an assertion that it is generated would be
 * false. Every later shape assertion survives, and the per-pair rules moved into
 * `src/compatibility/matrix/published-data.mjs` so the CLI's data file has a
 * guard rather than only a test.
 *
 * One assertion is REDUCED rather than kept whole: "each pair names the evidence
 * file that proves it" used to open each `evidence/*.json` and compare hashes.
 * That directory was deleted, so the reachable part — that the path is
 * well-formed and the digest is a digest — is what remains.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  publishedMatrixViolations,
  readPublishedMatrix,
} from "../../../../src/compatibility/matrix/published-data.mjs";
import { PUBLISHED_ARTIFACT_DIFFERENTIAL_DEFINITION as DEFINITION }
  from "../../../../src/compatibility/suites/published-artifact-differential/index.mjs";

const matrix = readPublishedMatrix();

test("the hand-maintained matrix satisfies every shape rule its generator used to", () => {
  const problems = publishedMatrixViolations(matrix);
  assert.deepEqual(problems, [], `compatibility.json is invalid:\n  - ${problems.join("\n  - ")}`);
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
  assert.equal(matrix.published, true);
  if (matrix.registryState?.supersedesEvidencedPair === true) {
    assert.equal(matrix.supportedRelease, null);
  } else {
    assert.match(matrix.supportedRelease.kit, /^\d+\.\d+\.\d+$/u);
    assert.match(matrix.supportedRelease.hyper, /^\d+\.\d+\.\d+$/u);
  }
  // The part that has not changed and must not: an individual pair still
  // carries no version, and a published release does not alter that.
  for (const pair of matrix.pairs) {
    assert.equal(pair.kit.version, null, `${pair.id} kit version must not assert a release`);
    assert.equal(pair.hyper.version, null, `${pair.id} hyper version must not assert a release`);
  }
});

test("the newest pair is the exact pair npm serves", () => {
  const pair = matrix.pairs.at(-1);
  const { kitFixed, hyperCurrent } = DEFINITION.packages;

  assert.deepEqual(
    { commit: pair.kit.commit, tarballSha256: pair.kit.tarballSha256, tree: pair.kit.tree },
    { commit: kitFixed.commit, tarballSha256: kitFixed.tarballSha256, tree: kitFixed.tree },
  );
  assert.deepEqual(
    { commit: pair.hyper.commit, tarballSha256: pair.hyper.tarballSha256, tree: pair.hyper.tree },
    {
      commit: hyperCurrent.commit,
      tarballSha256: hyperCurrent.tarballSha256,
      tree: hyperCurrent.tree,
    },
  );
  // The evidence still resolves to the exact packages it proved, whether or not
  // that pair is currently recommended.
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
  assert.match(registry.hazard, /visp-kit@[\d.]+/u);
  assert.match(registry.hazard, /visp-hyper-agent@[\d.]+/u);
  assert.match(registry.npm["visp-kit"], /^\d+\.\d+\.\d+$/u);
  assert.match(registry.npm["visp-hyper-agent"], /^\d+\.\d+\.\d+$/u);
});

test("each pair still names the evidence file that proved it", () => {
  // The files themselves went with the evidence deletion. The naming is what is
  // still checkable, and it is what a reader follows to ask for a re-run.
  for (const pair of matrix.pairs) {
    assert.match(pair.evidence, /^evidence\/.+\.json$/u, `${pair.id} evidence path`);
    assert.match(pair.evidenceSha256, /^[0-9a-f]{64}$/u, `${pair.id} evidence hash`);
  }
});

test("the shape guard can actually fail", () => {
  // A guard that never fires is indistinguishable from a guard that cannot.
  const broken = structuredClone(matrix);
  broken.pairs[0].kit.version = "0.2.3";
  broken.pairs[0].kit.commit = "not-a-commit";
  const problems = publishedMatrixViolations(broken);
  assert.equal(problems.length, 2);
  assert.match(problems.join("\n"), /commit is not a full commit ID/u);
  assert.match(problems.join("\n"), /version must not assert a release/u);
});
