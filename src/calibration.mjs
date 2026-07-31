/**
 * Whether Hyper's routing evidence is honest.
 *
 * The routing engine computes a 95% Wilson lower bound over per-cohort pass
 * rates before it will downgrade a model tier, and P8-01 made it record that
 * prediction alongside the outcome that followed. This asks the question those
 * two halves exist for: when the evidence said a cohort passes at rate p, did it
 * pass at rate p?
 *
 * Calibration is not accuracy. A well-calibrated system that says 70% and is
 * right 70% of the time is still wrong three times in ten. Calibration tells you
 * when to escalate; it does not tell you how to be right. Nothing here licenses
 * a claim about Visp's correctness, and nothing here may widen a permission —
 * Kit remains the sole authority for scope, evidence sufficiency, and
 * completion.
 *
 * Two rules shape every function below.
 *
 * **Never invent a number.** A segment with too little data reports
 * `insufficient` and its sample count, not a zero that reads as perfect
 * calibration. An attempt with no prediction is counted as un-calibratable and
 * named, never silently dropped from a denominator.
 *
 * **Segment, never average.** A system can be well calibrated on small localized
 * bugs and badly calibrated on cross-file migrations, and a single headline
 * number hides exactly the case that matters. Every metric is reported per
 * segment, and the overall figure is offered only alongside them.
 */

/**
 * Minimum decided samples before a segment gets a number rather than
 * `insufficient`.
 *
 * Deliberately the same 30 the routing engine already requires before it will
 * trust a cohort's pass rate enough to downgrade a tier
 * (`DOWNGRADE_MIN_SAMPLES`). Reusing it is the point: the threshold for
 * reporting whether the evidence was honest should not be looser than the
 * threshold for acting on it. A floor chosen independently would let this report
 * grade cohorts the router itself considers unproven.
 */
export const MIN_SEGMENT_SAMPLES = 30;

/** Equal-width bins across [0,1]. Ten is the common default for ECE. */
export const DEFAULT_BIN_COUNT = 10;

/**
 * Why an attempt could not be calibrated. Each is counted and reported; none is
 * silently discarded, because a denominator that quietly shrinks is how a bad
 * calibration figure turns into a good one.
 */
export const UNCALIBRATABLE_REASONS = Object.freeze({
  MALFORMED_RECORD: "malformed_record",
  NO_PREDICTION: "no_prediction",
  NO_PREDICTED_RATE: "no_predicted_rate",
  NON_FINITE_RATE: "non_finite_rate",
  RATE_OUT_OF_RANGE: "rate_out_of_range",
  UNDECIDED_VERDICT: "undecided_verdict"
});

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Split attempts into those that can be calibrated and those that cannot, with
 * a reason for every exclusion.
 *
 * An attempt is calibratable when it carries a prediction with a real rate and
 * its verdict is decided. `inconclusive` is excluded for the same reason the
 * router excludes it from its own denominator: it is not a binary outcome, and
 * scoring it either way would be a fabrication.
 */
export function partitionAttempts(attempts) {
  const calibratable = [];
  const excluded = [];

  for (const attempt of attempts) {
    // A non-record entry is corruption, not absence. Skipping it with `continue`
    // would delete it from every denominator with nothing saying so, which is
    // the silent-shrink this module exists to prevent.
    if (!isRecord(attempt)) {
      excluded.push({ attempt, reason: UNCALIBRATABLE_REASONS.MALFORMED_RECORD });
      continue;
    }
    const prediction = isRecord(attempt.prediction) ? attempt.prediction : null;

    if (prediction === null) {
      excluded.push({ attempt, reason: UNCALIBRATABLE_REASONS.NO_PREDICTION });
      continue;
    }
    if (typeof prediction.passRate !== "number") {
      excluded.push({ attempt, reason: UNCALIBRATABLE_REASONS.NO_PREDICTED_RATE });
      continue;
    }
    // typeof NaN === "number" and typeof Infinity === "number", so the type
    // check above admits both. NaN then indexes a bin that does not exist and
    // throws; Infinity propagates into ECE and the Brier score and serialises
    // to null in JSON, where it reads as "no data" rather than "corrupt data".
    if (!Number.isFinite(prediction.passRate)) {
      excluded.push({ attempt, reason: UNCALIBRATABLE_REASONS.NON_FINITE_RATE });
      continue;
    }
    // A probability outside [0,1] is not a low-confidence prediction, it is a
    // broken one. Clamping it into a bin would launder corruption into a
    // plausible-looking figure.
    if (prediction.passRate < 0 || prediction.passRate > 1) {
      excluded.push({ attempt, reason: UNCALIBRATABLE_REASONS.RATE_OUT_OF_RANGE });
      continue;
    }
    if (attempt.verdict !== "passed" && attempt.verdict !== "failed") {
      excluded.push({ attempt, reason: UNCALIBRATABLE_REASONS.UNDECIDED_VERDICT });
      continue;
    }
    calibratable.push({
      predicted: prediction.passRate,
      outcome: attempt.verdict === "passed" ? 1 : 0,
      attempt
    });
  }

  return { calibratable, excluded };
}

/**
 * Expected calibration error: the sample-weighted gap between what was predicted
 * and what happened, across equal-width bins.
 *
 * Returns the bins as well as the scalar, because the scalar alone cannot tell
 * you *where* the system is wrong — and a model that is overconfident at the top
 * of the range needs a different response from one that is underconfident in the
 * middle.
 */
export function expectedCalibrationError(pairs, binCount = DEFAULT_BIN_COUNT) {
  // Validated rather than trusted: a binCount of 0, a negative, or a fraction
  // produces an out-of-range index and an opaque "cannot read properties of
  // undefined" that tells the caller nothing about what they got wrong.
  if (!Number.isInteger(binCount) || binCount < 1) {
    throw new TypeError(`binCount must be a positive integer, received ${String(binCount)}`);
  }
  if (pairs.length === 0) return { ece: null, bins: [] };

  const bins = Array.from({ length: binCount }, (_, index) => ({
    lower: index / binCount,
    upper: (index + 1) / binCount,
    samples: 0,
    predictedSum: 0,
    observedSum: 0
  }));

  for (const { predicted, outcome } of pairs) {
    // The top edge belongs to the last bin, so a prediction of exactly 1 is not
    // dropped on the floor.
    const raw = Math.floor(predicted * binCount);
    const index = Math.min(Math.max(raw, 0), binCount - 1);
    const bin = bins[index];
    bin.samples += 1;
    bin.predictedSum += predicted;
    bin.observedSum += outcome;
  }

  let weighted = 0;
  const reported = [];
  for (const bin of bins) {
    if (bin.samples === 0) continue;
    const meanPredicted = bin.predictedSum / bin.samples;
    const observedRate = bin.observedSum / bin.samples;
    const gap = Math.abs(meanPredicted - observedRate);
    weighted += (bin.samples / pairs.length) * gap;
    reported.push({
      lower: bin.lower,
      upper: bin.upper,
      samples: bin.samples,
      meanPredicted,
      observedRate,
      gap,
      // Which way it is wrong, because the fix differs.
      direction: meanPredicted > observedRate ? "overconfident" : meanPredicted < observedRate ? "underconfident" : "exact"
    });
  }

  return { ece: weighted, bins: reported };
}

/**
 * Brier score: mean squared error of the probabilistic prediction.
 *
 * Lower is better; 0 is perfect. It rewards being both accurate and honest,
 * which is why it is reported next to ECE rather than instead of it — a system
 * can post a flattering ECE by always predicting the base rate, and the Brier
 * score notices.
 */
export function brierScore(pairs) {
  if (pairs.length === 0) return null;
  const total = pairs.reduce((sum, { predicted, outcome }) => {
    const error = predicted - outcome;
    return sum + error * error;
  }, 0);
  return total / pairs.length;
}

/**
 * Risk-coverage curve: the error rate that remains as the agent acts on fewer,
 * more confident cases.
 *
 * This is what converts calibration into a decision. It answers "if I only act
 * autonomously on the most confident X% and escalate the rest, what error rate
 * do I carry?" — which is how an escalation threshold gets chosen from a stated
 * error budget instead of by hand.
 *
 * Sorted by predicted confidence descending, so coverage grows from the cases
 * the system was surest about.
 *
 * **One point per distinct confidence, not one per row.** A real policy can only
 * say "act when predicted >= t", which takes a whole group of equally-confident
 * cases or none of it. Emitting a point in the middle of such a group would
 * advertise a coverage and error rate that no threshold can actually deliver —
 * and because `passRate` is computed per cohort, every attempt in a cohort
 * carries the identical value, so large tie groups are the normal shape of this
 * data rather than a curiosity. Splitting them also made the curve depend on the
 * order attempts happened to arrive in, which is not a property of the data at
 * all.
 */
export function riskCoverageCurve(pairs) {
  if (pairs.length === 0) return [];
  const sorted = [...pairs].sort((a, b) => b.predicted - a.predicted);
  const points = [];
  let errors = 0;

  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index].outcome === 0) errors += 1;
    const next = sorted[index + 1];
    // Still inside a tie group: no threshold can stop here.
    if (next !== undefined && next.predicted === sorted[index].predicted) continue;
    const covered = index + 1;
    points.push({
      coverage: covered / sorted.length,
      covered,
      errorRate: errors / covered,
      // The confidence at which this coverage is bought. Applying it as
      // `predicted >= threshold` reproduces exactly this coverage and this
      // error rate — that equivalence is the whole value of the field.
      threshold: sorted[index].predicted
    });
  }
  return points;
}

/**
 * The lowest confidence threshold whose error rate still fits a stated budget.
 *
 * Returns null when no threshold satisfies the budget — which is a real answer,
 * not a failure. It means autonomy at that error budget is not currently
 * supportable, and the honest response is to escalate more, not to relax the
 * budget until a number appears.
 */
export function thresholdForErrorBudget(curve, maxErrorRate) {
  let best = null;
  for (const point of curve) {
    if (point.errorRate <= maxErrorRate) {
      // Prefer the widest coverage that still fits.
      if (best === null || point.coverage > best.coverage) best = point;
    }
  }
  return best;
}

/**
 * Metrics for one segment, or an explicit statement that there is not enough
 * data to compute them.
 */
export function segmentReport(attempts, { binCount = DEFAULT_BIN_COUNT, minSamples = MIN_SEGMENT_SAMPLES } = {}) {
  const { calibratable, excluded } = partitionAttempts(attempts);
  const uncalibratable = {
    total: excluded.length,
    byReason: Object.fromEntries(
      Object.values(UNCALIBRATABLE_REASONS).map((reason) => [
        reason,
        excluded.filter((entry) => entry.reason === reason).length
      ])
    )
  };

  if (calibratable.length < minSamples) {
    return {
      status: "insufficient",
      samples: calibratable.length,
      required: minSamples,
      uncalibratable,
      // Named explicitly so a reader cannot mistake absence for a good result.
      note: `${calibratable.length} decided samples with a prediction; ${minSamples} required before a calibration figure means anything`
    };
  }

  const { ece, bins } = expectedCalibrationError(calibratable, binCount);
  const curve = riskCoverageCurve(calibratable);
  return {
    status: "reported",
    samples: calibratable.length,
    uncalibratable,
    expectedCalibrationError: ece,
    brierScore: brierScore(calibratable),
    bins,
    riskCoverage: curve,
    observedPassRate:
      calibratable.reduce((sum, pair) => sum + pair.outcome, 0) / calibratable.length,
    meanPredicted:
      calibratable.reduce((sum, pair) => sum + pair.predicted, 0) / calibratable.length
  };
}

/**
 * Group attempts by a segment key. Missing values become the string "unknown"
 * rather than being dropped, so an ungrouped population still shows up.
 */
export function groupBy(attempts, key) {
  const groups = new Map();
  for (const attempt of attempts) {
    if (!isRecord(attempt)) continue;
    const raw = attempt[key];
    const label = raw === null || raw === undefined ? "unknown" : String(raw);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(attempt);
  }
  return groups;
}

/**
 * The full report: overall plus every requested segmentation.
 *
 * The overall figure is included, but a reader who stops there has learned the
 * least useful thing in the document. It is placed after the segments for that
 * reason.
 */
export function createCalibrationReport(attempts, options = {}) {
  const {
    segmentBy = ["taskClass", "riskLevel", "assuranceProfile"],
    binCount = DEFAULT_BIN_COUNT,
    minSamples = MIN_SEGMENT_SAMPLES
  } = options;

  const segments = {};
  for (const key of segmentBy) {
    const grouped = groupBy(attempts, key);
    segments[key] = Object.fromEntries(
      [...grouped.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, group]) => [label, segmentReport(group, { binCount, minSamples })])
    );
  }

  return {
    schemaVersion: "visp.calibration-report.v1",
    generatedFrom: { attempts: attempts.length },
    minSamples,
    binCount,
    segments,
    overall: segmentReport(attempts, { binCount, minSamples }),
    limits: [
      "Calibration is not correctness. A system calibrated at 70% is still wrong 30% of the time.",
      "No public claim may be made from these numbers; the evaluation protocol's claim ceiling governs.",
      "Escalation precision and recall are NOT computed here: deciding whether an escalation was necessary needs a human label that no record carries. Reporting a proxy under that name would be worse than reporting nothing."
    ]
  };
}
