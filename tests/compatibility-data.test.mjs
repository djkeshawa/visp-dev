import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { buildCompatibility } from "../scripts/generate-compatibility.mjs";

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

test("the matrix does not claim anything is published", () => {
  // The only Visp versions on a registry are deprecated and predate this
  // matrix. Claiming otherwise would point users at defective builds.
  assert.equal(matrix.published, false);
  for (const pair of matrix.pairs) {
    assert.equal(pair.kit.version, null, `${pair.id} kit version must not assert a release`);
    assert.equal(pair.hyper.version, null, `${pair.id} hyper version must not assert a release`);
  }
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
