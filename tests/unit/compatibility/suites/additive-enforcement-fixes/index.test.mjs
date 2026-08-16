/**
 * GUTTED, not deleted, when the committed evidence directory was removed.
 *
 * What died: the `EVIDENCE` constant and every `accepted()` case, which read a
 * checked-in report and asserted things about it. What survives: the SHA256
 * shape test, the create-then-verify round trip, and the source assertion that
 * this suite never freezes an unreproducible action id. Those test the code,
 * not the sample.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { canonicalStringify, sha256Hex } from "../../../../../src/platform/canonical-json.mjs";
import {
  ADDITIVE_ENFORCEMENT_FIXES_DEFINITION as DEFINITION,
  ADDITIVE_ENFORCEMENT_FIXES_SHA256 as SHA256,
  ADDITIVE_ENFORCEMENT_OBSERVATIONS as OBSERVED,
  createAdditiveEnforcementFixesReport,
  observedAdditiveEnforcementSemantics,
  verifyAdditiveEnforcementFixesReport,
} from "../../../../../src/compatibility/suites/additive-enforcement-fixes/index.mjs";

const HASH = /^[0-9a-f]{64}$/u;
const SCHEMA_HASH = "sha256:77dcaba51ef8e1a78064680077f8bcc48c081d8025596c6cc8df9ea7873d68e9";

function packageEvidence(id) {
  const kit = id.startsWith("kit");
  const packageName = kit ? "visp-kit" : "visp-hyper-agent";
  return {
    install: {
      bins: [{
        name: kit ? "visp" : "visp-hyper",
        sha256: "a".repeat(64),
        target: `node_modules/${packageName}/dist/index.js`,
      }],
      lifecycleScriptsDisabled: true,
      offline: true,
    },
    pack: {
      byteEquality: true,
      first: { sha256: OBSERVED.packages[id] },
      second: { sha256: OBSERVED.packages[id] },
    },
    runtimeLock: {
      materializedSha256: "c".repeat(64),
      templateSha256: "d".repeat(64),
    },
    source: structuredClone(DEFINITION.packages[id]),
  };
}

function actionView(definition) {
  const observed = OBSERVED.scenarios[definition.id];
  const assuranceSummary = {
    artifact: {
      contentHash: `sha256:${"1".repeat(64)}`,
      path: ".visp/features/001-additive-fixes/assurance/T001/assurance-case.json",
    },
    caseHash: `sha256:${sha256Hex(`case-${definition.id}`)}`,
    mandatoryHotspots: observed.hotspots.map(([id, category]) => ({
      category,
      id,
      path: null,
      reason: `Kit reported required ${category} review.`,
      severity: category === "permissions" ? "critical" : "medium",
    })),
    reviewDecision: {
      decisionHash: definition.reviewStatus === "missing"
        ? null
        : `sha256:${sha256Hex(`decision-${definition.id}`)}`,
      reason: `Kit reported ${definition.reviewStatus}.`,
      required: observed.reviewRequired,
      status: definition.reviewStatus,
    },
    state: "available",
    verdict: definition.assuranceVerdict,
    version: "1.0",
  };
  return {
    actionId: `sha256:${sha256Hex(`action-${definition.id}`)}`,
    actionVerdict: observed.actionVerdict,
    assuranceSummary,
    assuranceVerdict: definition.assuranceVerdict,
    caseHash: assuranceSummary.caseHash,
    mandatoryHotspots: structuredClone(assuranceSummary.mandatoryHotspots),
    nextCommand: observed.nextCommand,
    protocolVersion: "3.2",
    reviewDecision: structuredClone(assuranceSummary.reviewDecision),
    schemaHash: DEFINITION.schemaHash,
  };
}

function completeInput() {
  return {
    compatibility: DEFINITION.compatibility.map((row) => {
      const view = {
        // Fresh each run, never frozen — see the definition's comment.
        actionId: `sha256:${sha256Hex(`row-${row.id}`)}`,
        actionVerdict: OBSERVED.compatibility[row.id].actionVerdict,
        nextCommand: OBSERVED.compatibility[row.id].nextCommand,
        protocolVersion: row.expectedProtocol,
        schemaHash: row.expectedSchemaHash,
        selectionMode: "advertised",
      };
      return {
        id: row.id,
        surfaces: DEFINITION.surfaces.map((id) => ({ id, view: structuredClone(view) })),
      };
    }),
    environment: {
      architecture: "x64",
      git: "git version 2.49.0",
      node: "v24.15.0",
      npm: "11.12.1",
      operatingSystem: "linux",
      pnpm: "11.3.0",
    },
    packages: Object.fromEntries(
      Object.keys(DEFINITION.packages).map((id) => [id, packageEvidence(id)]),
    ),
    scenarios: DEFINITION.scenarios.map((definition) => {
      const kit = actionView(definition);
      return {
        flow: definition.flow,
        id: definition.id,
        kit,
        profile: definition.profile,
        surfaces: DEFINITION.surfaces.map((id) => ({ id, view: structuredClone(kit) })),
      };
    }),
  };
}

function reseal(report) {
  const next = structuredClone(report);
  delete next.reportSha256;
  next.reportSha256 = sha256Hex(canonicalStringify(next));
  return next;
}

test("the definition pins the corrected Kit pair and the unchanged 3.2 wire contract", () => {
  const { compatibility, packages, scenarios, schemaHash, surfaces } = DEFINITION;

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
  assert.match(SHA256, HASH);
  assert.equal(Object.isFrozen(DEFINITION), true);
});

test("a produced report verifies, is bound to this definition, and is deterministic", () => {
  const first = createAdditiveEnforcementFixesReport(completeInput());
  const second = createAdditiveEnforcementFixesReport(completeInput());
  assert.deepEqual(first, second);
  assert.equal(verifyAdditiveEnforcementFixesReport(first), true);
  assert.equal(first.definitionSha256, SHA256);
  assert.deepEqual(first.summary, {
    compatibilityRowsPassed: 3,
    scenariosPassed: 4,
    surfacesPassed: 24,
    testsPassed: true,
  });

  const unhashed = structuredClone(first);
  delete unhashed.reportSha256;
  assert.equal(first.reportSha256, sha256Hex(canonicalStringify(unhashed)));

  // Every surface of every row agreed on one protocol and one schema hash.
  for (const row of first.compatibility) {
    for (const surface of row.surfaces) {
      assert.equal(surface.view.protocolVersion, "3.2");
      assert.equal(surface.view.schemaHash, SCHEMA_HASH);
      assert.equal(surface.view.selectionMode, "advertised");
    }
  }
});

test("all six Hyper surfaces bind to one identical Kit action per row", () => {
  const report = createAdditiveEnforcementFixesReport(completeInput());
  for (const row of report.compatibility) {
    const [first, ...rest] = row.surfaces;
    for (const surface of rest) {
      assert.deepEqual(surface.view, first.view, `${row.id} ${surface.id} disagreed with run`);
    }
  }
  for (const scenario of report.scenarios) {
    for (const surface of scenario.surfaces) {
      assert.deepEqual(surface.view, scenario.kit, `${scenario.id} ${surface.id} drifted from Kit`);
    }
  }
});

test("the verifier rejects a surface that silently disagrees with Kit", () => {
  const report = createAdditiveEnforcementFixesReport(completeInput());
  report.compatibility[0].surfaces[3].view.actionId = `sha256:${"0".repeat(64)}`;
  assert.throws(() => verifyAdditiveEnforcementFixesReport(reseal(report)), /equality/u);
});

test("the verifier rejects protocol, schema, next-command and selection drift", () => {
  for (const mutate of [
    (report) => { for (const s of report.compatibility[0].surfaces) s.view.protocolVersion = "3.1"; },
    (report) => { for (const s of report.compatibility[0].surfaces) s.view.schemaHash = `sha256:${"1".repeat(64)}`; },
    (report) => { for (const s of report.compatibility[0].surfaces) s.view.nextCommand = "visp ship --task T001"; },
    (report) => { for (const s of report.compatibility[0].surfaces) s.view.selectionMode = "assumed"; },
  ]) {
    const report = createAdditiveEnforcementFixesReport(completeInput());
    mutate(report);
    assert.throws(() => verifyAdditiveEnforcementFixesReport(reseal(report)));
  }
});

test("the verifier rejects pair identity and packed provenance drift", () => {
  for (const mutate of [
    (report) => { report.packages.kitNew.source.commit = "0".repeat(40); },
    (report) => { report.packages.kitNew.pack.first.sha256 = "2".repeat(64); },
    (report) => { report.packages.hyperNew.install.offline = false; },
    (report) => { report.packages.kitOld.install.lifecycleScriptsDisabled = false; },
  ]) {
    const report = createAdditiveEnforcementFixesReport(completeInput());
    mutate(report);
    assert.throws(() => verifyAdditiveEnforcementFixesReport(reseal(report)));
  }
});

test("the verifier rejects assurance rewrites and a tampered report hash", () => {
  const upgraded = createAdditiveEnforcementFixesReport(completeInput());
  // `inconclusive` must never be laundered into a pass.
  upgraded.scenarios[2].kit.actionVerdict = "ready";
  assert.throws(() => verifyAdditiveEnforcementFixesReport(reseal(upgraded)));

  const dropped = createAdditiveEnforcementFixesReport(completeInput());
  dropped.scenarios[0].kit.mandatoryHotspots = [];
  assert.throws(() => verifyAdditiveEnforcementFixesReport(reseal(dropped)));

  const tampered = createAdditiveEnforcementFixesReport(completeInput());
  tampered.reportSha256 = "3".repeat(64);
  assert.throws(() => verifyAdditiveEnforcementFixesReport(tampered), /hash does not match/u);

  const relabelled = createAdditiveEnforcementFixesReport(completeInput());
  relabelled.definitionSha256 = "4".repeat(64);
  assert.throws(() => verifyAdditiveEnforcementFixesReport(reseal(relabelled)), /identity is invalid/u);
});

test("the frozen observations are exactly what a completed report yields", () => {
  // The honest re-pin path: derive the constants from a run, never edit them
  // until the run stops failing.
  const report = createAdditiveEnforcementFixesReport(completeInput());
  const derived = observedAdditiveEnforcementSemantics(report);
  assert.deepEqual(derived.packages, OBSERVED.packages);
  assert.deepEqual(derived.scenarios, OBSERVED.scenarios);
  assert.deepEqual(derived.compatibility, OBSERVED.compatibility);
});

test("no compatibility action id is frozen, because it is not reproducible", () => {
  // Measured: identical packed Kit and Hyper, two consecutive journeys, two
  // different action IDs. Freezing one would make the evidence unrepeatable, so
  // the row freeze covers verdict and next command only. Within-run
  // cross-surface equality still binds the action ID, and that is asserted above.
  const source = readFileSync(
    new URL(
      "../../../../../src/compatibility/suites/additive-enforcement-fixes/definition.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const frozenBlock = source.slice(source.indexOf("ADDITIVE_ENFORCEMENT_OBSERVATIONS = deepFreeze"));
  const compatibilityBlock = frozenBlock.slice(
    frozenBlock.indexOf("compatibility: {"),
    frozenBlock.indexOf("packages: {"),
  );
  assert.ok(compatibilityBlock.length > 0, "the frozen compatibility block must be findable");
  assert.equal(compatibilityBlock.includes("actionId"), false);
});
