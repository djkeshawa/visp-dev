import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { canonicalStringify, sha256Hex } from "../src/compatibility-lab.mjs";
import {
  PHASE_4_COMPATIBILITY_DEFINITION,
  PHASE_4_COMPATIBILITY_SHA256,
  verifyPhase4CompatibilityReport,
} from "../src/phase-4-compatibility.mjs";

const HASH = /^[0-9a-f]{64}$/u;
const SCHEMA_HASH = "sha256:77dcaba51ef8e1a78064680077f8bcc48c081d8025596c6cc8df9ea7873d68e9";
const EVIDENCE = new URL("../evidence/phase-4-pair-linux-x64-node24.json", import.meta.url);

const accepted = () => JSON.parse(readFileSync(EVIDENCE, "utf8"));

/** Re-seals a mutated report so verification fails on meaning, not on the hash. */
function reseal(report) {
  const next = structuredClone(report);
  delete next.reportSha256;
  next.reportSha256 = sha256Hex(canonicalStringify(next));
  return next;
}

test("Phase 4 definition pins the corrected Kit pair and the unchanged 3.2 wire contract", () => {
  const { compatibility, packages, scenarios, schemaHash, surfaces } =
    PHASE_4_COMPATIBILITY_DEFINITION;

  assert.equal(packages.kitNew.commit, "3a8901b9b9fe788a0be98f247c75f9715db24723");
  assert.equal(packages.kitOld.commit, "d92364e8b3fd9d38771bcfe1df18fb9434a8ad4e");
  assert.equal(packages.hyperNew.commit, "61858199d90bffafb062bde61453f5def6357efa");
  assert.equal(packages.hyperOld.commit, "cda0c6ce43abc6a69f4a436026d482e95ed74a2c");
  for (const record of Object.values(packages)) {
    assert.match(record.commit, /^[0-9a-f]{40}$/u);
    assert.match(record.tree, /^[0-9a-f]{40}$/u);
  }

  // The whole claim: enforcement corrections did not move the wire contract.
  assert.equal(schemaHash, SCHEMA_HASH);
  assert.equal(compatibility.length, 3);
  for (const row of compatibility) {
    assert.equal(row.expectedProtocol, "3.2");
    assert.equal(row.expectedSchemaHash, SCHEMA_HASH);
  }
  assert.deepEqual(
    compatibility.map((row) => row.id),
    ["new_kit_old_hyper", "old_kit_new_hyper", "new_kit_new_hyper"],
  );

  assert.deepEqual(surfaces, ["run", "next", "resume", "checkpoint", "guard", "mcp"]);
  assert.equal(scenarios.length, 4);
  assert.match(PHASE_4_COMPATIBILITY_SHA256, HASH);
  assert.equal(Object.isFrozen(PHASE_4_COMPATIBILITY_DEFINITION), true);
});

test("Phase 4 accepted evidence verifies and is bound to this definition", () => {
  const report = accepted();
  assert.equal(verifyPhase4CompatibilityReport(report), true);
  assert.equal(report.definitionSha256, PHASE_4_COMPATIBILITY_SHA256);
  assert.equal(report.schemaVersion, "visp.phase-4-compatibility.evidence.v1");
  assert.deepEqual(report.summary, {
    compatibilityRowsPassed: 3,
    scenariosPassed: 4,
    surfacesPassed: 24,
    testsPassed: true,
  });

  const unhashed = structuredClone(report);
  delete unhashed.reportSha256;
  assert.equal(report.reportSha256, sha256Hex(canonicalStringify(unhashed)));

  // Every surface of every row agreed on one protocol and one schema hash.
  for (const row of report.compatibility) {
    for (const surface of row.surfaces) {
      assert.equal(surface.view.protocolVersion, "3.2");
      assert.equal(surface.view.schemaHash, SCHEMA_HASH);
      assert.equal(surface.view.selectionMode, "advertised");
    }
  }
});

test("Phase 4 binds all six Hyper surfaces to one identical Kit action per row", () => {
  const report = accepted();
  for (const row of report.compatibility) {
    const [first, ...rest] = row.surfaces;
    for (const surface of rest) {
      assert.deepEqual(
        surface.view,
        first.view,
        `${row.id} ${surface.id} disagreed with run`,
      );
    }
  }
  // Scenario surfaces must reproduce Kit's own action exactly.
  for (const scenario of report.scenarios) {
    for (const surface of scenario.surfaces) {
      assert.deepEqual(surface.view, scenario.kit, `${scenario.id} ${surface.id} drifted from Kit`);
    }
  }
});

test("Phase 4 verifier rejects a surface that silently disagrees with Kit", () => {
  const report = accepted();
  report.compatibility[0].surfaces[3].view.actionId = `sha256:${"0".repeat(64)}`;
  assert.throws(() => verifyPhase4CompatibilityReport(reseal(report)), /equality/u);
});

test("Phase 4 verifier rejects protocol, schema, and next-command drift", () => {
  for (const mutate of [
    (report) => { for (const s of report.compatibility[0].surfaces) s.view.protocolVersion = "3.1"; },
    (report) => { for (const s of report.compatibility[0].surfaces) s.view.schemaHash = `sha256:${"1".repeat(64)}`; },
    (report) => { for (const s of report.compatibility[0].surfaces) s.view.nextCommand = "visp ship --task T001"; },
    (report) => { for (const s of report.compatibility[0].surfaces) s.view.selectionMode = "assumed"; },
  ]) {
    const report = accepted();
    mutate(report);
    assert.throws(() => verifyPhase4CompatibilityReport(reseal(report)));
  }
});

test("Phase 4 verifier rejects pair identity and packed provenance drift", () => {
  for (const mutate of [
    (report) => { report.packages.kitNew.source.commit = "0".repeat(40); },
    (report) => { report.packages.kitNew.pack.first.sha256 = "2".repeat(64); },
    (report) => { report.packages.hyperNew.install.offline = false; },
    (report) => { report.packages.kitOld.install.lifecycleScriptsDisabled = false; },
  ]) {
    const report = accepted();
    mutate(report);
    assert.throws(() => verifyPhase4CompatibilityReport(reseal(report)));
  }
});

test("Phase 4 verifier rejects assurance rewrites and a tampered report hash", () => {
  const upgraded = accepted();
  // `inconclusive` must never be laundered into a pass.
  upgraded.scenarios[2].kit.actionVerdict = "ready";
  assert.throws(() => verifyPhase4CompatibilityReport(reseal(upgraded)));

  const dropped = accepted();
  dropped.scenarios[0].kit.mandatoryHotspots = [];
  assert.throws(() => verifyPhase4CompatibilityReport(reseal(dropped)));

  const tampered = accepted();
  tampered.reportSha256 = "3".repeat(64);
  assert.throws(() => verifyPhase4CompatibilityReport(tampered), /hash does not match/u);

  const relabelled = accepted();
  relabelled.definitionSha256 = "4".repeat(64);
  assert.throws(() => verifyPhase4CompatibilityReport(reseal(relabelled)), /identity is invalid/u);
});

test("Phase 4 does not freeze a compatibility action id, which is not reproducible", () => {
  // Measured: identical packed Kit and Hyper, two consecutive journeys, two
  // different action IDs. Freezing one would make the evidence unrepeatable,
  // so the row freeze covers verdict and next command only. Within-run
  // cross-surface equality still binds the action ID, and that is asserted
  // above.
  const source = readFileSync(new URL("../src/phase-4-compatibility.mjs", import.meta.url), "utf8");
  const frozenBlock = source.slice(
    source.indexOf("const PHASE_4_EXPECTED_SEMANTICS"),
    source.indexOf("function validatePackage"),
  );
  const compatibilityBlock = frozenBlock.slice(
    frozenBlock.indexOf("compatibility: {"),
    frozenBlock.indexOf("packages: {"),
  );
  assert.equal(compatibilityBlock.includes("actionId"), false);
});
