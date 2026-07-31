import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_BIN_COUNT,
  MIN_SEGMENT_SAMPLES,
  UNCALIBRATABLE_REASONS,
  brierScore,
  createCalibrationReport,
  expectedCalibrationError,
  partitionAttempts,
  riskCoverageCurve,
  segmentReport,
  thresholdForErrorBudget
} from "../src/calibration.mjs";

/**
 * P8-02. The protocol requires analysis code to be written and tested against
 * synthetic data with a known answer before real data exists, so that the
 * analysis cannot later be tuned to an outcome. Every test below constructs a
 * population whose correct result is known by construction.
 */

const attempt = (overrides = {}) => ({
  taskId: "T1",
  taskClass: "bounded_feature",
  riskLevel: "medium",
  assuranceProfile: "behavioral",
  verdict: "passed",
  prediction: { passRate: 0.9, lowerConfidenceBound: 0.8, samples: 40, inconclusive: 0, suggestedTier: "scout", reason: "r", tierUsed: "scout" },
  ...overrides
});

/** n attempts at a fixed predicted rate, of which `passes` actually passed. */
function population(n, predicted, passes) {
  return Array.from({ length: n }, (_, index) =>
    attempt({
      taskId: `T${index}`,
      verdict: index < passes ? "passed" : "failed",
      prediction: { passRate: predicted, lowerConfidenceBound: predicted, samples: 40, inconclusive: 0, suggestedTier: "scout", reason: "r", tierUsed: "scout" }
    })
  );
}

test("a perfectly calibrated population scores zero error", () => {
  // 100 attempts predicted at 0.7, exactly 70 of which pass. ECE must be 0 and
  // the Brier score must be exactly 0.7*0.09 + 0.3*0.49 = 0.21.
  const pairs = partitionAttempts(population(100, 0.7, 70)).calibratable;
  const { ece } = expectedCalibrationError(pairs);
  // Tolerance, not equality: 70/100 is not exactly representable, so a perfect
  // population lands a few ulps from zero. Asserting === 0 would make this test
  // fail for a reason that has nothing to do with calibration.
  assert.ok(Math.abs(ece) < 1e-12, `expected ~0, got ${ece}`);
  assert.ok(Math.abs(brierScore(pairs) - 0.21) < 1e-12);
});

test("a confidently wrong population scores the full gap", () => {
  // Predicted 0.9, observed 0.1. The gap is 0.8 and there is only one bin, so
  // the weighted ECE is exactly 0.8.
  const pairs = partitionAttempts(population(100, 0.9, 10)).calibratable;
  const { ece, bins } = expectedCalibrationError(pairs);
  assert.ok(Math.abs(ece - 0.8) < 1e-12);
  assert.equal(bins.length, 1);
  assert.equal(bins[0].direction, "overconfident");
});

test("underconfidence is reported as its own direction", () => {
  const pairs = partitionAttempts(population(100, 0.2, 80)).calibratable;
  const { bins } = expectedCalibrationError(pairs);
  assert.equal(bins[0].direction, "underconfident");
});

test("a prediction of exactly 1 lands in the last bin, not off the end", () => {
  // floor(1 * 10) is 10, which is out of range for ten bins. Dropping it would
  // silently exclude the most confident predictions — the ones that matter most.
  const pairs = partitionAttempts(population(40, 1, 40)).calibratable;
  const { ece, bins } = expectedCalibrationError(pairs);
  assert.equal(bins.length, 1);
  assert.equal(bins[0].samples, 40);
  assert.equal(bins[0].upper, 1);
  assert.equal(ece, 0);
});

test("ECE is sample-weighted, not a mean of bin gaps", () => {
  // 90 attempts perfectly calibrated at 0.5, plus 10 badly wrong at 0.95.
  // Unweighted mean of gaps would be ~0.475; weighted is ~0.095. The difference
  // is the whole point: a small bad bin must not dominate the headline.
  const pairs = partitionAttempts([
    ...population(90, 0.5, 45),
    ...population(10, 0.95, 0).map((a, i) => ({ ...a, taskId: `X${i}` }))
  ]).calibratable;
  const { ece } = expectedCalibrationError(pairs);
  assert.ok(Math.abs(ece - 0.095) < 1e-9, `expected ~0.095, got ${ece}`);
});

test("the risk-coverage curve improves as coverage narrows", () => {
  // Confident cases pass, unconfident ones fail. Acting only on the top half
  // should carry zero error; acting on everything should carry half.
  const pairs = partitionAttempts([
    ...population(50, 0.95, 50),
    ...population(50, 0.15, 0).map((a, i) => ({ ...a, taskId: `L${i}` }))
  ]).calibratable;
  const curve = riskCoverageCurve(pairs);
  // Two distinct confidences, so two reachable points — not one per row. A
  // point inside a tie group would promise a coverage no threshold can buy.
  assert.equal(curve.length, 2);
  assert.deepEqual(
    curve.map((point) => [point.covered, point.errorRate, point.threshold]),
    [[50, 0, 0.95], [100, 0.5, 0.15]]
  );
  assert.ok(curve[0].threshold > curve[1].threshold, "sorted by confidence descending");
});

test("an error budget that cannot be met returns null rather than a number", () => {
  // Everything fails. No threshold delivers a 1% error rate, and inventing one
  // would be the failure this whole unit exists to prevent.
  const pairs = partitionAttempts(population(50, 0.9, 0)).calibratable;
  assert.equal(thresholdForErrorBudget(riskCoverageCurve(pairs), 0.01), null);
});

test("an error budget that can be met returns the widest coverage that fits", () => {
  const pairs = partitionAttempts([
    ...population(80, 0.95, 80),
    ...population(20, 0.10, 0).map((a, i) => ({ ...a, taskId: `L${i}` }))
  ]).calibratable;
  const best = thresholdForErrorBudget(riskCoverageCurve(pairs), 0);
  assert.equal(best.covered, 80);
  assert.equal(best.errorRate, 0);
});

test("a thin segment reports insufficient, never a flattering zero", () => {
  const report = segmentReport(population(MIN_SEGMENT_SAMPLES - 1, 0.9, 27));
  assert.equal(report.status, "insufficient");
  assert.equal(report.samples, MIN_SEGMENT_SAMPLES - 1);
  assert.equal(report.required, MIN_SEGMENT_SAMPLES);
  assert.equal(report.expectedCalibrationError, undefined);
  assert.match(report.note, /required before a calibration figure means anything/u);
});

test("the floor is exactly the routing engine's own trust threshold", () => {
  // Reporting on whether the evidence was honest must not be looser than the
  // threshold for acting on it. Hyper's DOWNGRADE_MIN_SAMPLES is 30.
  assert.equal(MIN_SEGMENT_SAMPLES, 30);
  assert.equal(segmentReport(population(30, 0.5, 15)).status, "reported");
  assert.equal(segmentReport(population(29, 0.5, 15)).status, "insufficient");
});

test("un-calibratable attempts are counted and named, never silently dropped", () => {
  const { calibratable, excluded } = partitionAttempts([
    ...population(3, 0.9, 3),
    attempt({ taskId: "N1", prediction: null }),
    attempt({ taskId: "N2", prediction: { passRate: null, lowerConfidenceBound: null, samples: 0, inconclusive: 0, suggestedTier: "scout", reason: "r", tierUsed: "scout" } }),
    attempt({ taskId: "N3", verdict: "inconclusive" })
  ]);
  assert.equal(calibratable.length, 3);
  assert.equal(excluded.length, 3);
  const reasons = excluded.map((entry) => entry.reason).sort();
  assert.deepEqual(reasons, [
    UNCALIBRATABLE_REASONS.NO_PREDICTION,
    UNCALIBRATABLE_REASONS.NO_PREDICTED_RATE,
    UNCALIBRATABLE_REASONS.UNDECIDED_VERDICT
  ].sort());

  const report = segmentReport(population(30, 0.5, 15).concat([attempt({ prediction: null })]));
  assert.equal(report.uncalibratable.total, 1);
  assert.equal(report.uncalibratable.byReason[UNCALIBRATABLE_REASONS.NO_PREDICTION], 1);
});

test("inconclusive verdicts never become an outcome", () => {
  // Scoring an inconclusive either way is a fabrication. The router already
  // excludes them from its denominator; so does this.
  const { calibratable } = partitionAttempts(
    Array.from({ length: 10 }, () => attempt({ verdict: "inconclusive" }))
  );
  assert.equal(calibratable.length, 0);
});

test("an empty population yields null metrics, not zero", () => {
  assert.equal(expectedCalibrationError([]).ece, null);
  assert.equal(brierScore([]), null);
  assert.deepEqual(riskCoverageCurve([]), []);
});

test("segments are reported separately, so a good average cannot hide a bad class", () => {
  // One class perfectly calibrated, another badly. The overall figure is
  // mediocre; the segments show which is which.
  const good = population(40, 0.5, 20).map((a, i) => ({ ...a, taskId: `G${i}`, taskClass: "localized_bug" }));
  const bad = population(40, 0.95, 4).map((a, i) => ({ ...a, taskId: `B${i}`, taskClass: "migration" }));
  const report = createCalibrationReport([...good, ...bad], { segmentBy: ["taskClass"] });

  const byClass = report.segments.taskClass;
  assert.equal(byClass.localized_bug.status, "reported");
  assert.ok(Math.abs(byClass.localized_bug.expectedCalibrationError) < 1e-12);
  assert.equal(byClass.migration.status, "reported");
  assert.ok(byClass.migration.expectedCalibrationError > 0.8);
  assert.equal(report.overall.status, "reported");
});

test("the report states what it does not measure", () => {
  const report = createCalibrationReport(population(30, 0.5, 15));
  const limits = report.limits.join(" ");
  assert.match(limits, /Calibration is not correctness/u);
  assert.match(limits, /claim ceiling/u);
  // Escalation precision/recall needs a human label nobody has recorded.
  // Shipping a proxy under that name would be worse than shipping nothing.
  assert.match(limits, /Escalation precision and recall are NOT computed/u);
  assert.equal(report.binCount, DEFAULT_BIN_COUNT);
});

test("missing segment values group as unknown rather than vanishing", () => {
  const report = createCalibrationReport(
    population(30, 0.5, 15).map((a) => ({ ...a, taskClass: null })),
    { segmentBy: ["taskClass"] }
  );
  assert.ok(report.segments.taskClass.unknown, "null taskClass must still be reported");
  assert.equal(report.segments.taskClass.unknown.samples, 30);
});

/*
 * Added after an adversarial review of this module confirmed 21 defects, most
 * of them mutations that survived the suite above. Each test below names the
 * mutation it exists to kill — a test that cannot fail is decoration.
 */

test("the threshold a policy would set actually delivers the reported numbers", () => {
  // THE defect this module exists to prevent. passRate is computed per cohort,
  // so every attempt in a cohort shares one predicted value and large tie groups
  // are the normal shape of the data. Emitting a point inside a group advertises
  // a coverage no threshold can buy: the reviewer's case returned
  // {coverage:0.5, errorRate:0} for a threshold that really covers 0.7 at 0.286.
  const pairs = [
    ...Array.from({ length: 5 }, () => ({ predicted: 0.95, outcome: 1 })),
    ...Array.from({ length: 2 }, () => ({ predicted: 0.95, outcome: 0 })),
    ...Array.from({ length: 3 }, () => ({ predicted: 0.4, outcome: 1 }))
  ];
  const curve = riskCoverageCurve(pairs);
  assert.equal(curve.length, 2, "one point per distinct confidence, not per row");

  // The property that makes the field worth having: applying the threshold
  // reproduces the coverage and error rate the point advertises.
  for (const point of curve) {
    const taken = pairs.filter((pair) => pair.predicted >= point.threshold);
    assert.equal(taken.length, point.covered, `threshold ${point.threshold} coverage`);
    const realErrors = taken.filter((pair) => pair.outcome === 0).length / taken.length;
    assert.ok(Math.abs(realErrors - point.errorRate) < 1e-12, `threshold ${point.threshold} error rate`);
  }

  // And the budget that cannot be met now says so instead of handing back an
  // unreachable threshold.
  assert.equal(thresholdForErrorBudget(curve, 0.1), null);
});

test("the curve does not depend on the order attempts arrived in", () => {
  // Kills: reverting the tie collapse. V8's sort is stable, so splitting ties
  // made the curve a function of arrival order rather than of the data.
  const a = [
    { predicted: 0.9, outcome: 1 },
    { predicted: 0.9, outcome: 0 },
    { predicted: 0.5, outcome: 1 }
  ];
  const b = [a[1], a[0], a[2]];
  assert.deepEqual(riskCoverageCurve(a), riskCoverageCurve(b));
});

test("every input record is accounted for as calibratable or excluded", () => {
  // Kills: restoring the bare `continue` that dropped non-records, and any
  // future path that shrinks a denominator without recording why.
  const valid = Array.from({ length: 30 }, (_, i) =>
    attempt({ taskId: `V${i}`, prediction: { passRate: 0.9 } })
  );
  const input = [
    ...valid,
    null,
    undefined,
    [],
    "nonsense",
    attempt({ prediction: null }),
    attempt({ prediction: { passRate: "0.9" } }),
    attempt({ prediction: { passRate: Number.NaN } }),
    attempt({ prediction: { passRate: Number.POSITIVE_INFINITY } }),
    attempt({ prediction: { passRate: 1.5 } }),
    attempt({ prediction: { passRate: -0.1 } }),
    attempt({ verdict: "inconclusive" })
  ];
  const report = createCalibrationReport(input);
  assert.equal(
    report.overall.samples + report.overall.uncalibratable.total,
    input.length,
    "calibratable + uncalibratable must equal the input; anything else is a silent drop"
  );
  assert.deepEqual(report.overall.uncalibratable.byReason, {
    malformed_record: 4,
    no_prediction: 1,
    no_predicted_rate: 1,
    non_finite_rate: 2,
    rate_out_of_range: 2,
    undecided_verdict: 1
  });
});

test("NaN and Infinity are excluded rather than crashing or leaking", () => {
  // Kills: dropping the Number.isFinite guard. typeof NaN === "number", so the
  // type check alone admitted it; NaN then indexed a bin that does not exist and
  // threw, while Infinity propagated into ECE and serialised to null in JSON —
  // where corrupt data reads as no data.
  const populated = Array.from({ length: 30 }, (_, i) =>
    attempt({ taskId: `V${i}`, prediction: { passRate: 0.5 }, verdict: i < 15 ? "passed" : "failed" })
  );
  const report = segmentReport([
    ...populated,
    attempt({ prediction: { passRate: Number.NaN } }),
    attempt({ prediction: { passRate: Number.POSITIVE_INFINITY }, verdict: "failed" })
  ]);
  assert.equal(report.status, "reported");
  assert.equal(report.samples, 30);
  assert.ok(Number.isFinite(report.expectedCalibrationError));
  assert.ok(Number.isFinite(report.brierScore));
  assert.ok(Number.isFinite(report.meanPredicted));
  assert.equal(report.uncalibratable.byReason.non_finite_rate, 2);
});

test("a probability outside [0,1] is corruption, not low confidence", () => {
  // Kills: clamping out-of-range values into an edge bin, which launders a
  // broken number into a plausible-looking one.
  const { calibratable, excluded } = partitionAttempts([
    attempt({ prediction: { passRate: 1.5 } }),
    attempt({ prediction: { passRate: -0.1 } })
  ]);
  assert.equal(calibratable.length, 0);
  assert.deepEqual(
    excluded.map((entry) => entry.reason),
    [UNCALIBRATABLE_REASONS.RATE_OUT_OF_RANGE, UNCALIBRATABLE_REASONS.RATE_OUT_OF_RANGE]
  );
});

test("opposing bin errors do not cancel", () => {
  // Kills: deleting Math.abs. One bin overconfident by 0.5, another
  // underconfident by 0.4; without the absolute value they cancel to near zero
  // and a badly calibrated system reports as good.
  const pairs = partitionAttempts([
    ...population(50, 0.9, 20).map((a, i) => ({ ...a, taskId: `H${i}` })),
    ...population(50, 0.2, 30).map((a, i) => ({ ...a, taskId: `L${i}` }))
  ]).calibratable;
  const { ece, bins } = expectedCalibrationError(pairs);
  assert.equal(bins.length, 2);
  assert.ok(ece > 0.4, `opposing errors must add, not cancel; got ${ece}`);
  const directions = bins.map((bin) => bin.direction).sort();
  assert.deepEqual(directions, ["overconfident", "underconfident"]);
});

test("bin boundaries describe the bin they belong to", () => {
  // Kills: emitting constant lower/upper. A reader consulting the breakdown to
  // find WHERE the system is overconfident gets nothing from 0..1 on every row.
  const pairs = partitionAttempts([
    ...population(30, 0.25, 15).map((a, i) => ({ ...a, taskId: `A${i}` })),
    ...population(30, 0.85, 15).map((a, i) => ({ ...a, taskId: `B${i}` }))
  ]).calibratable;
  const { bins } = expectedCalibrationError(pairs);
  assert.equal(bins.length, 2);
  assert.deepEqual(bins.map((bin) => [bin.lower, bin.upper]), [[0.2, 0.3], [0.8, 0.9]]);
});

test("a perfectly calibrated bin is labelled exact, not overconfident", () => {
  const pairs = partitionAttempts(population(40, 0.5, 20)).calibratable;
  const { bins } = expectedCalibrationError(pairs);
  assert.equal(bins[0].direction, "exact");
  assert.equal(bins[0].gap, 0);
});

test("observedPassRate and meanPredicted are distinct and not swapped", () => {
  // Kills: swapping the two. A report claiming the system predicted 10% and
  // observed 95% tells the opposite story from the truth.
  const report = segmentReport(population(40, 0.95, 4));
  assert.ok(Math.abs(report.meanPredicted - 0.95) < 1e-12, "meanPredicted is what was predicted");
  assert.ok(Math.abs(report.observedPassRate - 0.1) < 1e-12, "observedPassRate is what happened");
});

test("binCount and minSamples are honoured, not just advertised", () => {
  // Kills: ignoring the options while the envelope truthfully reports them.
  const attempts = population(40, 0.5, 20);
  const coarse = createCalibrationReport(attempts, { binCount: 2, segmentBy: [] });
  assert.equal(coarse.binCount, 2);
  assert.ok(coarse.overall.bins.every((bin) => bin.upper - bin.lower === 0.5));

  const strict = createCalibrationReport(attempts, { minSamples: 100, segmentBy: [] });
  assert.equal(strict.minSamples, 100);
  assert.equal(strict.overall.status, "insufficient");
  assert.equal(strict.overall.required, 100);
});

test("an invalid binCount fails loudly instead of throwing about undefined", () => {
  for (const bad of [0, -1, 2.5, Number.NaN, null, "10"]) {
    assert.throws(
      () => expectedCalibrationError([{ predicted: 0.5, outcome: 1 }], bad),
      /binCount must be a positive integer/u,
      `binCount ${String(bad)} must be rejected clearly`
    );
  }
});

test("the report envelope carries its own provenance", () => {
  const report = createCalibrationReport(population(30, 0.5, 15));
  assert.equal(report.schemaVersion, "visp.calibration-report.v1");
  assert.equal(report.generatedFrom.attempts, 30);
  assert.equal(report.minSamples, MIN_SEGMENT_SAMPLES);
});

test("segments are emitted in a stable order", () => {
  const report = createCalibrationReport(
    [
      ...population(5, 0.5, 2).map((a, i) => ({ ...a, taskId: `Z${i}`, taskClass: "zeta" })),
      ...population(5, 0.5, 2).map((a, i) => ({ ...a, taskId: `A${i}`, taskClass: "alpha" }))
    ],
    { segmentBy: ["taskClass"] }
  );
  assert.deepEqual(Object.keys(report.segments.taskClass), ["alpha", "zeta"]);
});
