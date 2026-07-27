import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { REQUIRED_FAMILIES, runConformance, verifyConformanceReport } from "../src/conformance.mjs";

const committed = JSON.parse(
  readFileSync(new URL("../evidence/conformance-linux-x64-node24.json", import.meta.url), "utf8")
);

test("the committed conformance report verifies and is current", async () => {
  assert.equal(verifyConformanceReport(committed), true);
  const rebuilt = await runConformance();
  assert.deepEqual(committed, rebuilt);
});

test("required families are declared independently of the evidence that exists", () => {
  // If families were derived from the evidence, every gap would vanish by
  // construction and the report would always read complete.
  const declared = REQUIRED_FAMILIES.map((family) => family.id);
  for (const id of ["hook", "operating_system", "security", "failure_mode"]) {
    assert.ok(declared.includes(id), `${id} must be required independently of its evidence`);
  }

  // The operating_system family names macOS and Windows reports that do not
  // exist yet. Removing them would close the gap on paper without running a
  // single fixture on either platform.
  const operatingSystem = REQUIRED_FAMILIES.find((family) => family.id === "operating_system");

  assert.ok(operatingSystem.evidence.some((entry) => entry.includes("darwin")));
  assert.ok(operatingSystem.evidence.some((entry) => entry.includes("win32")));
});

test("the verdict is partial while families remain unproven", () => {
  assert.equal(committed.verdict, "partial");
  assert.ok(committed.summary.gaps > 0);
  // hook, security, and failure_mode closed once fixtures ran against packed
  // binaries. operating_system cannot close from a Linux workstation: it needs
  // macOS and Windows reports, which only the CI matrix can produce.
  assert.deepEqual(committed.summary.gapIds, ["operating_system"]);
});

test("coverage does not conceal the defects the evidence recorded", () => {
  // A family can be fully evidenced and still unhealthy. If this ever reads
  // clean, it is because the defects were fixed or because the report stopped
  // reporting them, and the two must not be confusable.
  assert.deepEqual(committed.summary.knownDefects, [
    "corrupted_artifact_detected_by_next",
    "interrupted_run_recovers"
  ]);

  const failureMode = committed.families.find((family) => family.id === "failure_mode");

  assert.equal(failureMode.status, "covered");
  assert.ok(failureMode.knownDefects.length > 0, "covered must not imply defect-free");
});

test("a report claiming completeness while listing gaps is rejected", () => {
  const lying = structuredClone(committed);
  lying.verdict = "complete";
  assert.throws(() => verifyConformanceReport(lying), /hash does not match/u);
});

test("every covered family names the evidence that covers it", () => {
  for (const family of committed.families.filter((entry) => entry.status === "covered")) {
    assert.ok(family.reports.length > 0, `${family.id} claims coverage with no evidence`);
    for (const report of family.reports) {
      assert.equal(report.present, true);
      assert.match(report.reportSha256, /^[0-9a-f]{64}$/u);
    }
  }
});

test("conformance is measured against the assembled release candidate", () => {
  assert.equal(committed.candidate.status, "assembled_not_published");
  assert.ok(committed.candidate.artifacts.length >= 2);
});
