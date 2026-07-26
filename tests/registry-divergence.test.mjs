import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { createDivergenceReport, verifyDivergenceReport } from "../src/registry-divergence.mjs";

const evidence = JSON.parse(
  readFileSync(new URL("../evidence/registry-divergence-linux-x64-node24.json", import.meta.url), "utf8")
);

test("the committed divergence evidence verifies", () => {
  assert.equal(verifyDivergenceReport(evidence), true);
});

test("a published version carrying different content is recorded as diverged", () => {
  const hyper = evidence.packages.find((entry) => entry.packageName === "visp-hyper-agent");

  // This is the whole point: npm and the repository both claim 0.3.0 and the
  // contents are not the same. A version range would call these compatible.
  assert.equal(hyper.status, "diverged");
  assert.notEqual(hyper.local.sha256, hyper.published.sha256);
  assert.ok(hyper.comparison.differing.length > 0, "expected differing files");
  assert.match(hyper.localCommit, /^[0-9a-f]{40}$/u);
});

test("the report is self-hashed and tamper-evident", () => {
  const tampered = structuredClone(evidence);
  tampered.packages[0].status = "identical";

  assert.throws(() => verifyDivergenceReport(tampered), /hash does not match/u);
});

test("claiming diverged while the hashes match is rejected", () => {
  const contradictory = createDivergenceReport({
    packages: [
      {
        packageName: "x",
        version: "1.0.0",
        status: "identical",
        local: { sha256: "a".repeat(64), fileCount: 1 },
        published: { sha256: "a".repeat(64), fileCount: 1 },
        comparison: { onlyLocal: [], onlyPublished: [], differing: [], identical: 1 }
      }
    ]
  });

  assert.equal(verifyDivergenceReport(contradictory), true);

  const lying = structuredClone(contradictory);
  lying.packages[0].status = "diverged";
  delete lying.reportSha256;
  const resealed = createDivergenceReport({ packages: lying.packages });

  assert.throws(() => verifyDivergenceReport(resealed), /reports diverged but the hashes match/u);
});
