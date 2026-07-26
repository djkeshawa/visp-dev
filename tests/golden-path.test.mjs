import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { GOLDEN_PATH_STEPS, verifyGoldenPathReport } from "../src/golden-path.mjs";

const report = JSON.parse(
  readFileSync(new URL("../evidence/golden-path-linux-x64-node24.json", import.meta.url), "utf8")
);

test("the committed golden path verifies and covers every required step", () => {
  assert.equal(verifyGoldenPathReport(report), true);
  assert.deepEqual(
    report.steps.map((step) => step.id),
    GOLDEN_PATH_STEPS
  );
});

test("the demonstration includes being blocked, not only the happy path", () => {
  const blocked = report.steps.find((step) => step.id === "out_of_scope_change_blocked");

  // A demo that only shows success proves nothing about a product whose claim
  // is that it stops work lacking proof.
  assert.ok(blocked.observed.scopeFindings >= 1);
  assert.ok(blocked.observed.titles.includes("Out-of-scope file changed"));
});

test("the correction reverts rather than widening scope to fit the edit", () => {
  const corrected = report.steps.find((step) => step.id === "scope_corrected");

  // The distinction the demonstration must make: an out-of-scope edit is
  // reverted, not legitimised by expanding the task to cover it after the fact.
  assert.match(corrected.observed.correction, /^reverted\b/u);
  assert.match(corrected.observed.correction, /rather than widening the task scope$/u);
});

test("the assurance verdict is not overclaimed", () => {
  const assurance = report.steps.find((step) => step.id === "assurance_case_produced");
  // Oracle-result mapping is incomplete, so `inconclusive` is the honest answer.
  assert.equal(assurance.observed.verdict, "inconclusive");
  assert.ok(assurance.observed.mandatoryHotspots >= 1);
});

test("the human decision is bound to the exact case", () => {
  const decision = report.steps.find((step) => step.id === "human_decision_recorded");
  assert.equal(decision.observed.boundToCase, true);
  assert.equal(decision.observed.status, "current");
});

test("the demonstration is pinned to exact packed binaries", () => {
  for (const side of ["kit", "hyper"]) {
    assert.match(report.packages[side].commit, /^[0-9a-f]{40}$/u);
    assert.match(report.packages[side].tarballSha256, /^[0-9a-f]{64}$/u);
  }
});

test("a report missing the blocked step is rejected", () => {
  const weakened = structuredClone(report);
  weakened.steps = weakened.steps.filter((step) => step.id !== "out_of_scope_change_blocked");
  assert.throws(() => verifyGoldenPathReport(weakened), /hash does not match|every required step/u);
});
