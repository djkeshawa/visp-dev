import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canonicalStringify, sha256Hex } from "../src/compatibility-lab.mjs";
import {
  PHASE_6_COMPATIBILITY_DEFINITION,
  PHASE_6_COMPATIBILITY_SHA256,
  verifyPhase6CompatibilityReport
} from "../src/phase-6-compatibility.mjs";
import {
  PHASE_6_RUN_IDENTITY,
  syntheticPhase6Report
} from "./helpers/release-evidence-fixtures.mjs";

const committed = JSON.parse(
  await readFile(new URL("../evidence/phase-6-pair-linux-x64-node24.json", import.meta.url), "utf8")
);

function rehash(report) {
  delete report.reportSha256;
  report.reportSha256 = sha256Hex(canonicalStringify(report));

  return report;
}

test("the frozen definition is deeply immutable", () => {
  assert.throws(() => {
    PHASE_6_COMPATIBILITY_DEFINITION.packages.kitFixed.commit = "0".repeat(40);
  });
  assert.throws(() => {
    PHASE_6_COMPATIBILITY_DEFINITION.compatibility.push({ id: "smuggled" });
  });
  assert.match(PHASE_6_COMPATIBILITY_SHA256, /^[0-9a-f]{64}$/u);
});

test("a newly produced report verifies against the D-107 pair and carries its run identity", () => {
  const report = syntheticPhase6Report();

  assert.equal(verifyPhase6CompatibilityReport(report), true);
  assert.equal(report.definitionSha256, PHASE_6_COMPATIBILITY_SHA256);
  assert.equal(report.schemaHash, PHASE_6_COMPATIBILITY_DEFINITION.schemaHash);
  assert.deepEqual(report.runIdentity, PHASE_6_RUN_IDENTITY);
  assert.equal(report.compatibility.length, 3);
});

test("the committed report is genuine packed D-107 evidence", () => {
  assert.equal(verifyPhase6CompatibilityReport(committed), true);
  assert.equal(committed.producer, "packed-runner");
  assert.equal(committed.definitionSha256, PHASE_6_COMPATIBILITY_SHA256);
});

test("every surface negotiated protocol 3.2 on the unchanged schema hash", () => {
  for (const row of syntheticPhase6Report().compatibility) {
    assert.equal(row.surfaces.length, PHASE_6_COMPATIBILITY_DEFINITION.surfaces.length);

    for (const surface of row.surfaces) {
      assert.equal(surface.view.protocolVersion, "3.2", `${row.id}/${surface.id}`);
      assert.equal(
        surface.view.schemaHash,
        PHASE_6_COMPATIBILITY_DEFINITION.schemaHash,
        `${row.id}/${surface.id}`
      );
    }
  }
});

test("the corrected Kit matches the previous Kit on a healthy project", () => {
  // The claim this phase exists to make: F-C1 and F-C2 changed behaviour only
  // for input that was already broken. An integrator running healthy projects
  // observes nothing new.
  const report = syntheticPhase6Report();

  assert.equal(report.differential.identical, true);
  assert.equal(report.differential.corrected, "fixed_kit_current_hyper");
  assert.equal(report.differential.baseline, "previous_kit_current_hyper");
});

test("a failed differential is rejected rather than reported", () => {
  const lying = syntheticPhase6Report();

  lying.differential.identical = false;

  assert.throws(
    () => verifyPhase6CompatibilityReport(rehash(lying)),
    /differential result does not match/u
  );
});

test("a report whose packages drift from the frozen pair is rejected", () => {
  const drifted = syntheticPhase6Report();

  drifted.packages.kitFixed.commit = "0".repeat(40);

  assert.throws(
    () => verifyPhase6CompatibilityReport(rehash(drifted)),
    /drifted from the frozen Phase 6 definition/u
  );
});

test("rehashed omissions and semantic rewrites cannot weaken the evidence", () => {
  const missingPackage = syntheticPhase6Report();

  delete missingPackage.packages.hyperCurrent;
  assert.throws(
    () => verifyPhase6CompatibilityReport(rehash(missingPackage)),
    /Phase 6 packages has an unexpected field set/u
  );

  const missingSurface = syntheticPhase6Report();

  missingSurface.compatibility[0].surfaces.pop();
  assert.throws(
    () => verifyPhase6CompatibilityReport(rehash(missingSurface)),
    /compatibility fixed_kit_previous_hyper drifted/u
  );

  const rewritten = syntheticPhase6Report();

  for (const surface of rewritten.compatibility[0].surfaces) {
    surface.view.nextCommand = "visp done --task T001";
  }
  assert.throws(
    () => verifyPhase6CompatibilityReport(rehash(rewritten)),
    /semantic observation drifted/u
  );
});

test("the pinned pair names the exact D-107 artifacts and preserves the historical baseline", () => {
  // If Kit moves again, this is what notices the evidence describes an older
  // Kit than the repository holds. `evidence:currency` is the tool that says
  // whether that gap matters; this assertion is what makes the gap visible.
  assert.deepEqual(PHASE_6_COMPATIBILITY_DEFINITION.packages.kitFixed, {
    commit: "eb70bce84568e9237690be1eea61355bbff23157",
    name: "visp-kit",
    tarballSha256: "1261d18eee28f7f196ab94d5099b54a3f66c36c74dfd1fab83bbba86f1f7e538",
    tree: "c1cef391194a20a57704bfaa6ed36c7f1b163756",
    version: "0.2.3"
  });
  assert.deepEqual(PHASE_6_COMPATIBILITY_DEFINITION.packages.hyperCurrent, {
    commit: "3538457ae51f79245358321668c1f3566c5eac74",
    name: "visp-hyper-agent",
    tarballSha256: "27ce00657b98b8303119122fe5851300059a21581ff5a4ab7f0cc4c3a08a89e2",
    tree: "55ca7ea10865630119f792eb227c9634e0fee8f9",
    version: "0.4.3"
  });
  assert.equal(
    PHASE_6_COMPATIBILITY_DEFINITION.packages.kitPrevious.commit,
    "19d5ffb3276e52462a945c66043f48e31cd6b38f"
  );
});
