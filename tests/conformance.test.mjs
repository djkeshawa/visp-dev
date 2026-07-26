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
    assert.ok(declared.includes(id), `${id} must be required even though it has no evidence`);
  }
});

test("the verdict is partial while families remain unproven", () => {
  assert.equal(committed.verdict, "partial");
  assert.ok(committed.summary.gaps > 0);
  assert.deepEqual(committed.summary.gapIds, ["failure_mode", "hook", "operating_system", "security"]);
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
