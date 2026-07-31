import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const rc = JSON.parse(
  readFileSync(new URL("../evidence/release-candidate-linux-x64-node24.json", import.meta.url), "utf8")
);

test("the candidate is assembled and explicitly not published", () => {
  assert.equal(rc.status, "assembled_not_published");
  assert.match(rc.note, /has no registry write path/u);
});

test("every artifact is identified by commit and hash, and repacks byte-identically", () => {
  assert.ok(rc.artifacts.length >= 2);
  for (const artifact of rc.artifacts) {
    assert.match(artifact.commit, /^[0-9a-f]{40}$/u);
    assert.match(artifact.tree, /^[0-9a-f]{40}$/u);
    assert.match(artifact.tarballSha256, /^[0-9a-f]{64}$/u);
    // A candidate that does not repack to the same bytes cannot be verified
    // against its own hash immediately before upload.
    assert.equal(artifact.byteIdenticalOnRepack, true, `${artifact.name} is not reproducible`);
  }
});

test("no artifact reuses a version that already exists on the registry", () => {
  // A published version number is immutable content. The assembler refuses to
  // build over one; this asserts the outcome.
  // Every version npm has ever served, not just the deprecated ones. The list
  // stopped at 0.3.0 while six more releases went out, so it would not have
  // caught a candidate reusing 0.2.2 — the exact mistake it exists to prevent.
  const taken = new Set([
    "visp-kit@0.1.0",
    "visp-kit@0.2.0",
    "visp-kit@0.2.1",
    "visp-kit@0.2.2",
    "visp-hyper-agent@0.2.0",
    "visp-hyper-agent@0.3.0",
    "visp-hyper-agent@0.4.0",
    "visp-hyper-agent@0.4.1",
    "visp-hyper-agent@0.4.2"
  ]);
  for (const artifact of rc.artifacts) {
    assert.equal(taken.has(`${artifact.name}@${artifact.version}`), false);
  }
});

test("known limitations name what would otherwise mislead", () => {
  const text = rc.knownLimitations.join(" ");
  assert.match(text, /deprecated/u);
  assert.match(text, /exact-pair/u);
  assert.match(text, /inconclusive/u);
  assert.match(text, /No performance or review-efficiency claim/u);
  assert.match(text, /one real repository/u);
});

test("publication preconditions include lifting the freeze and re-verifying hashes", () => {
  const text = rc.publicationPreconditions.join(" ");
  assert.match(text, /freeze is lifted/u);
  assert.match(text, /re-verified immediately before upload/u);
});
