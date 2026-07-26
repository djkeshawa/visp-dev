import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const protocol = JSON.parse(
  readFileSync(new URL("../evaluations/protocol.json", import.meta.url), "utf8")
);
const prose = readFileSync(new URL("../evaluations/protocol.md", import.meta.url), "utf8");

test("the protocol is frozen but not preregistered while the freeze holds", () => {
  // Preregistration is publication. Claiming preregistered without publishing a
  // timestamped copy would be the exact dishonesty the protocol exists to stop.
  assert.equal(protocol.preregistered, false);
  assert.match(protocol.preregistrationNote, /forbids publication/u);
});

test("every hypothesis has a metric and a threshold it can fail", () => {
  assert.ok(protocol.hypotheses.length >= 4);
  for (const hypothesis of protocol.hypotheses) {
    assert.ok(hypothesis.primaryMetric.length > 0, `${hypothesis.id} needs a metric`);
    assert.ok(Object.keys(hypothesis.threshold).length > 0, `${hypothesis.id} needs a threshold`);
  }
});

test("inconvenient results are explicitly not an exclusion", () => {
  for (const forbidden of ["poor_model_performance", "analyst_disagrees_with_a_block", "inconvenient_result"]) {
    assert.ok(protocol.exclusions.forbidden.includes(forbidden));
    assert.ok(!protocol.exclusions.permitted.includes(forbidden));
  }
});

test("the failure categories can record Visp being wrong", () => {
  // A category set with no false_block cannot detect over-blocking, which is
  // the failure mode most likely to kill adoption.
  assert.ok(protocol.failureCategories.includes("false_block"));
  assert.ok(protocol.failureCategories.includes("false_pass"));
});

test("the analysis forbids optional stopping and post-hoc analysis code", () => {
  assert.equal(protocol.analysis.optionalStopping, false);
  assert.equal(protocol.analysis.analysisCodeWrittenBeforeData, true);
  assert.equal(protocol.analysis.multiplicityCorrection, "holm_bonferroni");
});

test("publishing a claim requires publishing null results too", () => {
  assert.ok(protocol.publicationConditions.includes("negative_and_null_results_published_equally"));
  assert.ok(protocol.publicationConditions.includes("raw_artifacts_published"));
});

test("the protocol states what it cannot establish", () => {
  assert.ok(protocol.cannotEstablish.length >= 4);
  assert.match(prose, /## What this protocol cannot establish/u);
});

test("dogfooding is named as engineering feedback, not evidence for a hypothesis", () => {
  // Three runs on one repository with the author as operator and no control arm
  // is legitimate feedback and illegitimate as a product claim.
  assert.match(prose, /illegitimate as a product claim/u);
});
