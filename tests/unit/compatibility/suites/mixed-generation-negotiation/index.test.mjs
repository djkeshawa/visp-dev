import assert from "node:assert/strict";
import test from "node:test";

import { canonicalStringify, sha256Hex } from "../../../../../src/platform/canonical-json.mjs";
import {
  MIXED_GENERATION_NEGOTIATION_DEFINITION as DEFINITION,
  MIXED_GENERATION_NEGOTIATION_SHA256 as SHA256,
  MIXED_GENERATION_OBSERVATIONS as OBSERVED,
  createMixedGenerationNegotiationReport,
  verifyMixedGenerationNegotiationReport,
} from "../../../../../src/compatibility/suites/mixed-generation-negotiation/index.mjs";

const HASH = /^[0-9a-f]{64}$/u;

function packageEvidence(id) {
  const expected = DEFINITION.packages[id];
  const kit = id.startsWith("kit");
  const packageName = kit ? "visp-kit" : "visp-hyper-agent";
  const bin = kit ? "visp" : "visp-hyper";
  return {
    install: {
      bins: [{
        name: bin,
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
    source: structuredClone(expected),
  };
}

function actionView(definition) {
  const decisionHash = definition.reviewStatus === "missing"
    ? null
    : `sha256:${sha256Hex(`decision-${definition.id}`)}`;
  const assuranceSummary = {
    artifact: {
      contentHash: `sha256:${"1".repeat(64)}`,
      path: ".visp/features/001-mixed-generation/assurance/T001/assurance-case.json",
    },
    caseHash: `sha256:${sha256Hex(`case-${definition.id}`)}`,
    mandatoryHotspots: OBSERVED.scenarios[definition.id].hotspots.map(([id, category]) => ({
      category,
      id,
      path: null,
      reason: `Kit reported required ${category} review.`,
      severity: category === "permissions" ? "critical" : "medium",
    })),
    reviewDecision: {
      decisionHash,
      reason: `Kit reported ${definition.reviewStatus}.`,
      required: OBSERVED.scenarios[definition.id].reviewRequired,
      status: definition.reviewStatus,
    },
    state: "available",
    verdict: definition.assuranceVerdict,
    version: "1.0",
  };
  return {
    actionId: `sha256:${sha256Hex(`action-${definition.id}`)}`,
    actionVerdict: OBSERVED.scenarios[definition.id].actionVerdict,
    assuranceSummary,
    assuranceVerdict: definition.assuranceVerdict,
    caseHash: assuranceSummary.caseHash,
    mandatoryHotspots: structuredClone(assuranceSummary.mandatoryHotspots),
    nextCommand: OBSERVED.scenarios[definition.id].nextCommand,
    protocolVersion: "3.2",
    reviewDecision: structuredClone(assuranceSummary.reviewDecision),
    schemaHash: DEFINITION.schemaHash,
  };
}

function completeInput() {
  return {
    compatibility: DEFINITION.compatibility.map((row) => {
      const view = {
        actionId: OBSERVED.compatibility[row.id].actionId,
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

function rehash(report) {
  delete report.reportSha256;
  report.reportSha256 = sha256Hex(canonicalStringify(report));
}

function mutateScenarioEverywhere(report, scenarioIndex, mutate) {
  const scenario = report.scenarios[scenarioIndex];
  mutate(scenario.kit);
  for (const surface of scenario.surfaces) mutate(surface.view);
}

test("the definition pins exact producers, 3.2 trust, the additive boundary, and golden flows", () => {
  assert.deepEqual(DEFINITION.packages, {
    hyperNew: {
      commit: "cda0c6ce43abc6a69f4a436026d482e95ed74a2c",
      tree: "9694a2d7e36215ee95336ade735f1a5426698187",
    },
    hyperOld: {
      commit: "98b65d05a10766cb66b1caa9cb7ae3c5c589137d",
      tree: "34bb04ed2454e389f7aca7bea76fd05ab81f264c",
    },
    kitNew: {
      commit: "d92364e8b3fd9d38771bcfe1df18fb9434a8ad4e",
      tree: "6aa999a59ad7bd3b77f6b85bc07fabd6575d9f95",
    },
    kitOld: {
      commit: "3dbc9184e8ee4bb7d1599aa825bfd2ed57b384d8",
      tree: "6b5a45bed9f97007490f553c0d6d3af81be8ae2e",
    },
  });
  assert.equal(
    DEFINITION.schemaHash,
    "sha256:77dcaba51ef8e1a78064680077f8bcc48c081d8025596c6cc8df9ea7873d68e9",
  );
  assert.deepEqual(
    DEFINITION.compatibility.map(({ id, expectedProtocol }) => [id, expectedProtocol]),
    [
      ["new_kit_old_hyper", "3.1"],
      ["old_kit_new_hyper", "3.1"],
      ["new_kit_new_hyper", "3.2"],
    ],
  );
  assert.deepEqual(
    DEFINITION.scenarios.map(
      ({ profile, flow, reviewStatus, summaryState, assuranceVerdict }) => [
        profile,
        flow,
        reviewStatus,
        summaryState,
        assuranceVerdict,
      ],
    ),
    [
      ["routine", "accepted", "current", "available", "inconclusive"],
      ["behavioral", "rejected", "rejected", "available", "inconclusive"],
      ["critical", "stale", "stale", "available", "inconclusive"],
      ["critical", "inconclusive", "missing", "available", "inconclusive"],
    ],
  );
  assert.equal(Object.isFrozen(DEFINITION), true);
  assert.match(SHA256, HASH);
});

test("the report is deterministic, self-hashed, and preserves Kit facts on all surfaces", () => {
  const first = createMixedGenerationNegotiationReport(completeInput());
  const second = createMixedGenerationNegotiationReport(completeInput());
  assert.deepEqual(first, second);
  assert.equal(verifyMixedGenerationNegotiationReport(first), true);
  assert.deepEqual(first.summary, {
    compatibilityRowsPassed: 3,
    scenariosPassed: 4,
    surfacesPassed: 24,
    testsPassed: true,
  });
  assert.match(first.reportSha256, HASH);
  assert.doesNotMatch(
    JSON.stringify(first),
    /visp-compatibility-lab-|timestamp|generatedAt|checkedAt|duration|\/tmp\//iu,
  );
});

test("the verifier rejects coordinated semantic rewrites across Kit and every Hyper surface", () => {
  const report = createMixedGenerationNegotiationReport(completeInput());
  const rewrites = [
    (candidate) => {
      mutateScenarioEverywhere(candidate, 0, (view) => {
        view.assuranceSummary.mandatoryHotspots = [];
        view.mandatoryHotspots = [];
      });
    },
    (candidate) => {
      mutateScenarioEverywhere(candidate, 3, (view) => {
        view.assuranceSummary.reviewDecision.required = false;
        view.reviewDecision.required = false;
      });
    },
    (candidate) => {
      mutateScenarioEverywhere(candidate, 2, (view) => {
        view.actionVerdict = "ready";
        view.nextCommand = "visp pr";
      });
    },
    (candidate) => {
      for (const surface of candidate.compatibility[0].surfaces) {
        surface.view.actionId = `sha256:${"e".repeat(64)}`;
        surface.view.actionVerdict = "blocked";
        surface.view.nextCommand = "visp pr";
      }
    },
    (candidate) => {
      for (const packageRecord of Object.values(candidate.packages)) {
        packageRecord.pack.first.sha256 = "e".repeat(64);
        packageRecord.pack.second.sha256 = "e".repeat(64);
      }
    },
  ];
  for (const rewrite of rewrites) {
    const candidate = structuredClone(report);
    rewrite(candidate);
    rehash(candidate);
    assert.throws(() => verifyMixedGenerationNegotiationReport(candidate));
  }
});

test("the verifier rejects producer, protocol, assurance, surface, provenance, and hash drift", () => {
  const report = createMixedGenerationNegotiationReport(completeInput());
  const mutations = [
    (candidate) => { candidate.packages.kitNew.source.commit = "0".repeat(40); },
    (candidate) => { candidate.packages.hyperNew.pack.byteEquality = false; },
    (candidate) => { candidate.compatibility[0].surfaces[0].view.protocolVersion = "3.2"; },
    (candidate) => { candidate.compatibility[1].surfaces.pop(); },
    (candidate) => { candidate.scenarios[0].kit.assuranceSummary.reviewDecision.status = "rejected"; },
    (candidate) => { candidate.scenarios[1].kit.caseHash = `sha256:${"e".repeat(64)}`; },
    (candidate) => { candidate.scenarios[2].surfaces[0].view.nextCommand = "visp pr"; },
    (candidate) => { candidate.scenarios[2].surfaces.pop(); },
    (candidate) => { candidate.scenarios[3].kit.assuranceVerdict = "passed"; },
    (candidate) => { candidate.summary.surfacesPassed = 23; },
    (candidate) => { candidate.environment.operatingSystem = ""; },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(report);
    mutate(candidate);
    rehash(candidate);
    assert.throws(() => verifyMixedGenerationNegotiationReport(candidate));
  }
  const invalidHash = structuredClone(report);
  invalidHash.reportSha256 = "0".repeat(64);
  assert.throws(() => verifyMixedGenerationNegotiationReport(invalidHash));
});
