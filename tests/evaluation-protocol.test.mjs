import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const protocol = JSON.parse(
  readFileSync(new URL("../evaluations/protocol.json", import.meta.url), "utf8")
);
const prose = readFileSync(new URL("../evaluations/protocol.md", import.meta.url), "utf8");

test("preregistration cannot be claimed without an external record", () => {
  // This used to assert the note mentioned the D-069 freeze. That freeze was
  // lifted by D-097, so the test was pinning a reason that had expired while the
  // conclusion it guarded stayed correct for a different one.
  //
  // The invariant is that the flag cannot be flipped on its own. Preregistration
  // means a timestamped copy held by someone with no stake in the result, so
  // claiming it requires naming when and where — and a commit to this repository
  // is not that, because this project can rewrite this repository's history.
  assert.equal(
    protocol.preregistered,
    protocol.preregisteredAt !== null && protocol.preregistrationLocation !== null,
    "preregistered must agree with the record that would substantiate it",
  );

  if (protocol.preregistered === false) {
    assert.equal(protocol.preregisteredAt, null);
    assert.equal(protocol.preregistrationLocation, null);
    assert.match(prose, /Frozen, not preregistered/u);
  }

  // The freeze is lifted, so nothing may still cite it as the reason.
  assert.doesNotMatch(protocol.preregistrationNote, /freeze forbids/u);
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

test("the version matches the latest revision entry", () => {
  // A revision that bumps the prose but not the record, or the record but not
  // the version, produces results citing a protocol version that never existed.
  const latest = protocol.revisions.at(-1);
  assert.equal(protocol.version, latest.version);
  assert.equal(protocol.revised, latest.date);
  assert.match(prose, new RegExp(`\\*\\*Version:\\*\\* ${protocol.version}`, "u"));
});

test("repeated trials measure all-k success, not best-of-k", () => {
  // Running k trials and reporting the best subset is optional stopping in
  // another costume. The protocol already forbids the original; this forbids
  // the variant that only becomes available once k > 1.
  assert.equal(protocol.repeatedTrials.allTrialsCount, true);
  assert.equal(protocol.analysis.bestOfTrialsSelection, false);
  assert.equal(protocol.repeatedTrials.trialsIndependent, true);
  assert.match(protocol.repeatedTrials.passKDefinition, /ALL k trials/u);
});

test("main-study k stays inside the declared range", () => {
  // The range is declared in advance so the number can be chosen from pilot
  // variance rather than from whichever value produced a nicer figure.
  const { k } = protocol.repeatedTrials;
  assert.ok(k.mainStudyMin >= 2, "k below 2 cannot measure consistency at all");
  assert.ok(k.mainStudyMax >= k.mainStudyMin);
  assert.ok(k.mainStudyDefaultIfPilotInconclusive >= k.mainStudyMin);
  assert.ok(k.mainStudyDefaultIfPilotInconclusive <= k.mainStudyMax);
  if (k.mainStudy !== null) {
    assert.ok(k.mainStudy >= k.mainStudyMin && k.mainStudy <= k.mainStudyMax);
  }
});

test("a failed trial did not quietly become an exclusion", () => {
  // More runs per task means more chances to want a bad one dropped. The
  // exclusion list is the thing that would have to change for that, so assert
  // it did not.
  assert.equal(protocol.repeatedTrials.failedTrialIsNotAnExclusion, true);
  assert.ok(!protocol.exclusions.permitted.includes("failed_trial"));
  assert.ok(!protocol.exclusions.permitted.includes("poor_model_performance"));
});

test("narrowing repeats to a subset must be recorded", () => {
  // Repeats cost k times as much, so narrowing is permitted. Narrowing without
  // saying so reads as full coverage, which is the dishonest version.
  assert.equal(protocol.repeatedTrials.subsetPermitted, true);
  assert.equal(protocol.repeatedTrials.subsetMustBeRecorded, true);
});

test("pass^k is descriptive and licenses no claim", () => {
  // It is reported, not tested. If it ever becomes a hypothesis it needs a
  // threshold like every other, and adding one to the family tightens the
  // multiplicity correction on H1-H4 — which is a decision, not a side effect.
  const descriptive = protocol.descriptiveMetrics.metrics;
  assert.ok(descriptive.includes("pass_k"));
  for (const hypothesis of protocol.hypotheses) {
    assert.ok(
      !descriptive.includes(hypothesis.primaryMetric),
      `${hypothesis.id} tests a metric declared descriptive; give it a threshold or drop it from descriptiveMetrics`,
    );
  }
  assert.match(prose, /## Repeated trials and reliability/u);
});

test("the v1.1 revision changed no frozen hypothesis or threshold", () => {
  // The whole value of a frozen protocol is that a later revision cannot quietly
  // move a threshold. Pin the four hypotheses and their thresholds as frozen at
  // v1.0 so any future edit to them has to break a test on the way through.
  const frozenAtV1 = {
    H1: { primaryMetric: "out_of_scope_files_per_accepted_change", relativeReduction: 0.3 },
    H2: { primaryMetric: "implementer_authored_passing_without_change_rate", relativeReduction: 0.3 },
    H3: { primaryMetric: "median_task_to_decision_minutes_routine", maxMedianIncrease: 0.2 },
    H4: { primaryMetric: "decision_agreement_and_active_review_minutes", minAgreement: 0.9, minTimeReduction: 0.2 },
  };
  assert.equal(protocol.hypotheses.length, 4, "a fifth hypothesis changes the correction on the other four");
  for (const hypothesis of protocol.hypotheses) {
    const expected = frozenAtV1[hypothesis.id];
    assert.ok(expected, `unexpected hypothesis ${hypothesis.id}`);
    assert.equal(hypothesis.primaryMetric, expected.primaryMetric);
    for (const [key, value] of Object.entries(expected)) {
      if (key === "primaryMetric") continue;
      assert.equal(hypothesis.threshold[key], value, `${hypothesis.id}.${key} moved`);
    }
  }
});
