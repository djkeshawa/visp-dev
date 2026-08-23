import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CRITICAL_PATHS,
  createEvidenceCurrencyReport,
  evidenceCurrencyAnnotations,
  evidenceCurrencyExitCode,
  evidenceCurrencyVerdict,
  renderEvidenceCurrency,
  verifyEvidenceCurrencyReport,
} from "../../../../src/compatibility/registry/currency.mjs";

const repository = (overrides) => ({
  name: "visp-kit",
  pinnedCommit: "a".repeat(40),
  headCommit: "b".repeat(40),
  commitsBehind: 1,
  changedFileCount: 1,
  risk: "material",
  criticalPathsTouched: [],
  ...overrides,
});

const workflow = readFileSync(new URL("../../../../.github/workflows/test.yml", import.meta.url), "utf8");

function workflowStep(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `missing workflow step: ${name}`);
  const end = workflow.indexOf("\n      - name:", start + 1);
  return workflow.slice(start, end === -1 ? undefined : end);
}

test("an unmoved repository reports current", () => {
  const report = createEvidenceCurrencyReport({
    evidence: "published-artifact-differential",
    repositories: [
      repository({
        commitsBehind: 0,
        changedFileCount: 0,
        risk: "current",
        headCommit: "a".repeat(40),
      }),
    ],
  });
  assert.equal(report.summary.current, true);
  assert.equal(report.summary.risk, "current");
  assert.equal(verifyEvidenceCurrencyReport(report), true);
});

test("the worst risk across repositories decides the verdict", () => {
  const report = createEvidenceCurrencyReport({
    evidence: "published-artifact-differential",
    repositories: [
      repository({ name: "visp-hyper-agent", risk: "inert" }),
      repository({ name: "visp-kit", risk: "invalidating" }),
    ],
  });
  // A single invalidating repository invalidates the pair. Averaging risk across
  // repositories would let a quiet one mask a broken one.
  assert.equal(report.summary.risk, "invalidating");
  assert.match(report.summary.verdict, /no longer describes them/u);
});

test("inert movement is reported as movement, not as currency", () => {
  const report = createEvidenceCurrencyReport({
    evidence: "published-artifact-differential",
    repositories: [repository({ risk: "inert" })],
  });
  // Documentation churn genuinely cannot change behaviour, but the evidence
  // still does not describe the checked-out tree, and saying "current" would be
  // a lie of convenience.
  assert.equal(report.summary.current, false);
  assert.equal(report.summary.risk, "inert");
});

test("a report claiming currency while repositories moved is rejected", () => {
  const report = createEvidenceCurrencyReport({
    evidence: "published-artifact-differential",
    repositories: [repository({ risk: "inert" })],
  });
  const lying = structuredClone(report);
  lying.summary.current = true;
  assert.throws(() => verifyEvidenceCurrencyReport(lying), /hash does not match/u);
});

test("the wire schema and integration surface are classed as invalidating", () => {
  // These two are the difference between "re-run to be safe" and "this evidence
  // is void". Demoting either would let a schema change pass as a caution.
  const invalidating = CRITICAL_PATHS
    .filter((entry) => entry.severity === "invalidating")
    .map((entry) => entry.prefix);
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

// ---------------------------------------------------------------------------
// LC-76 — the advisory job must be advisory in the only way GitHub measures.
// ---------------------------------------------------------------------------

const movedReport = (risk, overrides = {}) =>
  createEvidenceCurrencyReport({
    evidence: "published-artifact-differential",
    repositories: [repository({ risk, ...overrides })],
  });

test("advisory mode changes the exit code and nothing else about the verdict", () => {
  // The whole contract in one assertion: same report, same classification, same
  // text — one number differs.
  for (const risk of ["current", "inert", "unclassified", "material", "invalidating"]) {
    const report = movedReport(risk);

    assert.equal(evidenceCurrencyExitCode(report, { advisory: true }), 0, `${risk} must not fail`);
    assert.equal(report.summary.risk, risk, "advisory must not soften the classification");
    assert.ok(renderEvidenceCurrency(report).includes(report.summary.verdict));
  }
});

test("without the flag an invalidating gap still fails and nothing else does", () => {
  // The flag must not become the only mode. Somebody gating on this — a human
  // at a terminal, a future job that should block — still gets the old answer.
  assert.equal(evidenceCurrencyExitCode(movedReport("invalidating")), 1);
  for (const risk of ["current", "inert", "unclassified", "material"]) {
    assert.equal(evidenceCurrencyExitCode(movedReport(risk)), 0, `${risk} must not fail the build`);
  }
  // The default is the gating one, so forgetting the option cannot silence it.
  assert.equal(evidenceCurrencyExitCode(movedReport("invalidating"), {}), 1);
  assert.equal(evidenceCurrencyExitCode(movedReport("invalidating"), { advisory: false }), 1);
});

test("the rendered report names every repository, its lag and its critical paths", () => {
  const report = createEvidenceCurrencyReport({
    evidence: "published-artifact-differential",
    repositories: [
      repository({
        name: "visp-kit",
        commitsBehind: 12,
        changedFileCount: 34,
        risk: "invalidating",
        criticalPathsTouched: [
          { prefix: "schemas/", reason: "the WorkflowAction wire schema", severity: "invalidating", files: 2 },
        ],
      }),
      repository({ name: "visp-hyper-agent", commitsBehind: 0, changedFileCount: 0, risk: "current" }),
    ],
  });
  const rendered = renderEvidenceCurrency(report);

  assert.match(rendered, /visp-kit\s+12 commits behind, 34 files, risk=invalidating/u);
  assert.match(rendered, /visp-hyper-agent\s+0 commits behind, 0 files, risk=current/u);
  assert.match(rendered, /schemas\/ \(2\) — the WorkflowAction wire schema \[invalidating\]/u);
  assert.equal(rendered.endsWith("\n"), true);
});

test("a repository that has moved is annotated; one that has not is left alone", () => {
  // A warning that is always there is decoration, which is how the permanently
  // red check was being read in the first place.
  const drifted = movedReport("material", { name: "visp-kit", commitsBehind: 9 });
  const [annotation, ...rest] = evidenceCurrencyAnnotations(drifted);

  assert.equal(rest.length, 0, "one annotation per repository that moved");
  assert.match(annotation, /^::warning title=Evidence currency::/u);
  assert.match(annotation, /visp-kit is 9 commits past the pin/u);
  assert.match(annotation, /risk=material/u);
  assert.ok(annotation.includes(evidenceCurrencyVerdict("material")), "the verdict travels with it");

  assert.deepEqual(evidenceCurrencyAnnotations(movedReport("current")), []);
});

test("each annotation states its own repository's risk, not the pair's worst", () => {
  // summary.verdict is the worst risk across the pair. Attaching it to every
  // repository told a reader that the one at `material` had moved the wire
  // schema — the wrong repository, named on the pull request, in a warning
  // written to be believed.
  const mixed = createEvidenceCurrencyReport({
    evidence: "published-artifact-differential",
    repositories: [
      repository({ name: "visp-kit", risk: "invalidating" }),
      repository({ name: "visp-hyper-agent", risk: "material" }),
    ],
  });
  const byName = Object.fromEntries(
    evidenceCurrencyAnnotations(mixed).map((line) => [line.split(" is ")[0].split("::").pop(), line])
  );

  assert.equal(mixed.summary.risk, "invalidating", "the summary still reports the worst");
  assert.ok(byName["visp-kit"].includes(evidenceCurrencyVerdict("invalidating")));
  assert.ok(byName["visp-hyper-agent"].includes(evidenceCurrencyVerdict("material")));
  assert.equal(
    byName["visp-hyper-agent"].includes("wire schema"),
    false,
    "a material repository must not be announced as having moved the wire schema"
  );
});

test("the summary verdict and the per-risk sentence are the same sentence", () => {
  // One definition. Two copies of these five sentences is how the annotation
  // and the report start describing the same measurement differently.
  for (const risk of ["current", "inert", "unclassified", "material", "invalidating"]) {
    assert.equal(movedReport(risk).summary.verdict, evidenceCurrencyVerdict(risk));
  }
});

test("an annotation stays on one line whatever the report contains", () => {
  // GitHub reads a workflow command up to the newline, so an unescaped one
  // truncates the message and spills the rest into the log as bare text.
  // The two fields that reach the message and are not drawn from a fixed list:
  // the repository name comes from the caller, and a critical-path prefix from
  // CRITICAL_PATHS, which is edited by hand.
  const report = movedReport("material", {
    name: "visp-kit\nat 50%\r",
    criticalPathsTouched: [
      { prefix: "src/gates/\nsecond line", reason: "gate decisions", severity: "material", files: 1 },
    ],
  });
  const [annotation] = evidenceCurrencyAnnotations(report);

  assert.doesNotMatch(annotation, /[\n\r]/u, "a raw newline truncates the annotation");
  assert.ok(annotation.includes("%0A"), "a newline must survive as an escape, not vanish");
  assert.ok(annotation.includes("%0D"));
  assert.ok(annotation.includes("%25"), "a bare % is a workflow-command escape introducer");
});

test("the advisory job publishes its verdict instead of publishing a failure", () => {
  // `continue-on-error` at the JOB level changes the workflow run's conclusion
  // and not the job's, so GitHub published this job as a check run with
  // conclusion: failure and `gh pr checks` printed `fail` on every pull
  // request. The job must not carry it, and the step must absorb the verdict
  // itself rather than through `|| true`, which would swallow a real crash too.
  const job = workflow.slice(workflow.indexOf("  evidence-currency:"));
  const header = job.slice(0, job.indexOf("    steps:"));

  assert.doesNotMatch(header, /continue-on-error/u, "the advisory job must not be a failing check");

  const step = workflowStep("Measure drift from the frozen evidence identities");

  assert.match(step, /--advisory/u);
  assert.doesNotMatch(step, /\|\|\s*true/u, "a crash must still fail this step");
  assert.match(step, /GITHUB_STEP_SUMMARY/u, "the verdict has to land where a human reads it");
});

test("the Windows spawn diagnostic keeps its own continue-on-error", () => {
  // A different step, a different reason, a different ticket. Sweeping every
  // `continue-on-error` out of the file would have taken this with it.
  assert.match(workflow, /^\s+continue-on-error: true$/mu);
});
