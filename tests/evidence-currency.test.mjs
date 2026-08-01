import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  CRITICAL_PATHS,
  createEvidenceCurrencyReport,
  verifyEvidenceCurrencyReport
} from "../src/evidence-currency.mjs";

const repository = (overrides) => ({
  name: "visp-kit",
  pinnedCommit: "a".repeat(40),
  headCommit: "b".repeat(40),
  commitsBehind: 1,
  changedFileCount: 1,
  risk: "material",
  criticalPathsTouched: [],
  ...overrides
});

const workflow = readFileSync(new URL("../.github/workflows/test.yml", import.meta.url), "utf8");

function workflowStep(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);

  assert.notEqual(start, -1, `missing workflow step: ${name}`);
  const end = workflow.indexOf("\n      - name:", start + 1);

  return workflow.slice(start, end === -1 ? undefined : end);
}

test("an unmoved repository reports current", () => {
  const report = createEvidenceCurrencyReport({
    evidence: "phase-6.json",
    repositories: [
      repository({ commitsBehind: 0, changedFileCount: 0, risk: "current", headCommit: "a".repeat(40) })
    ]
  });

  assert.equal(report.summary.current, true);
  assert.equal(report.summary.risk, "current");
  assert.equal(verifyEvidenceCurrencyReport(report), true);
});

test("the worst risk across repositories decides the verdict", () => {
  const report = createEvidenceCurrencyReport({
    evidence: "phase-6.json",
    repositories: [
      repository({ name: "visp-hyper-agent", risk: "inert" }),
      repository({ name: "visp-kit", risk: "invalidating" })
    ]
  });

  // A single invalidating repository invalidates the pair. Averaging risk
  // across repositories would let a quiet one mask a broken one.
  assert.equal(report.summary.risk, "invalidating");
  assert.match(report.summary.verdict, /no longer describes them/u);
});

test("inert movement is reported as movement, not as currency", () => {
  const report = createEvidenceCurrencyReport({
    evidence: "phase-6.json",
    repositories: [repository({ risk: "inert" })]
  });

  // Documentation churn genuinely cannot change behaviour, but the evidence
  // still does not describe the checked-out tree, and saying "current" would
  // be a lie of convenience.
  assert.equal(report.summary.current, false);
  assert.equal(report.summary.risk, "inert");
});

test("a report claiming currency while repositories moved is rejected", () => {
  const report = createEvidenceCurrencyReport({
    evidence: "phase-6.json",
    repositories: [repository({ risk: "inert" })]
  });
  const lying = structuredClone(report);

  lying.summary.current = true;

  assert.throws(() => verifyEvidenceCurrencyReport(lying), /hash does not match/u);
});

test("the wire schema and integration surface are classed as invalidating", () => {
  // These two are the difference between "re-run to be safe" and "this
  // evidence is void". Demoting either would let a schema change pass as a
  // caution.
  const invalidating = CRITICAL_PATHS.filter((entry) => entry.severity === "invalidating").map(
    (entry) => entry.prefix
  );

  assert.deepEqual(invalidating.sort(), ["schemas/", "src/integration/"]);
});

test("every critical path declares a reason a reader can act on", () => {
  for (const critical of CRITICAL_PATHS) {
    assert.ok(critical.reason.length > 0, `${critical.prefix} has no reason`);
    assert.ok(["invalidating", "material"].includes(critical.severity));
  }
});

test("the advisory currency job checks out enough engine history to reach its evidence pins", () => {
  for (const name of ["Check out current Kit", "Check out current Hyper"]) {
    assert.match(workflowStep(name), /^\s+fetch-depth: 0$/mu);
  }
});
