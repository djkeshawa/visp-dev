import assert from "node:assert/strict";
import test from "node:test";

import { canonicalStringify, sha256Hex } from "../src/compatibility-lab.mjs";
import {
  PHASE_3_COMPATIBILITY_DEFINITION,
  PHASE_3_COMPATIBILITY_SHA256,
  createPhase3CompatibilityReport,
  verifyPhase3CompatibilityReport,
} from "../src/phase-3-compatibility.mjs";

const HASH = /^[0-9a-f]{64}$/u;
const COMPATIBILITY_ACTION_IDS = {
  new_kit_old_hyper: "sha256:8423630645be62bb4fb6bedf7aa28b24bc4417dd5695c76d05ebb3e79dd1e891",
  old_kit_new_hyper: "sha256:548298798ff3f719750ba93e0a18449a9b0ecffd677d20b9e1b2d8d30254be72",
  new_kit_new_hyper: "sha256:9315dd8821ea5e2917afc5456d2e42bdb88c38a7abe8a10add368249707852ec",
};
const PACKAGE_HASHES = {
  hyperNew: "5a917a5111e0178c9e712655a366e7536bc5f5873c3c6800c261423e3829d43d",
  hyperOld: "95e91eac9b3bab510cf801d67815ddd961022d008176dd4780e490843349701a",
  kitNew: "6ab0a137018095685088d688dea889147a763bd4d2b8601ada2f9e29b6bc1f8d",
  kitOld: "5be534dad6fc6e76ca803bf3dcd7316bd6ebe3cd91053e4b3993c6bf2b0798a5",
};
const SCENARIO_HOTSPOTS = {
  routine_accepted: [
    ["HS-10-8525b69745abc7c139ca0982104f8dea9c2f6ce55667d519cad30eed74412d9f", "validation_command_change"],
    ["HS-20-2dacd3d42d42d17dd80208beac8cda8e049122ac826bb5f01caaca39f071502b", "unmapped_change"],
    ["HS-20-4cc0ee3b392fc85e087ed9ac0a8a2683497610ad8b532a7dbd3df7b3b0e42925", "inconclusive_evidence"],
  ],
  behavioral_rejected: [
    ["HS-10-02736d27c87c19d131d2d80711ee1a1ee4edb6a1ea764863600f6313a0184e57", "validation_command_change"],
    ["HS-20-2d70548b253a512e581e57a27be48f9b09d2dde86f07b6af4744997a3bb2a36c", "unmapped_change"],
    ["HS-20-4cc0ee3b392fc85e087ed9ac0a8a2683497610ad8b532a7dbd3df7b3b0e42925", "inconclusive_evidence"],
  ],
  critical_stale: [
    ["HS-00-5fe04c2895e241871da2faaeeba28781e91c9a3eba4e11af340de45e37b77729", "permissions"],
    ["HS-10-0e4bfbb88987d6e8a0bd23c1a940e6ca54fba8d5f6be966c1efc53fac1de84d1", "validation_command_change"],
    ["HS-20-359ec31c990b193e9a991e268788e4326c475c4acd8c72bb4b044b05ef8320c1", "unmapped_change"],
    ["HS-20-4cc0ee3b392fc85e087ed9ac0a8a2683497610ad8b532a7dbd3df7b3b0e42925", "inconclusive_evidence"],
  ],
  critical_inconclusive: [
    ["HS-00-61493e67cf93703897e0888cd4eff13b362ab5874b6e70129da23f57f696099f", "permissions"],
    ["HS-10-9dda892742a0ca799735ece91a911594053df93a103bfa7996f7dc604daeb6fa", "validation_command_change"],
    ["HS-20-4cc0ee3b392fc85e087ed9ac0a8a2683497610ad8b532a7dbd3df7b3b0e42925", "inconclusive_evidence"],
    ["HS-20-e4e34d3ac69c7420a8646d4d4e5d8a39c026eda59d98928ffd58d967acbcfc6d", "unmapped_change"],
  ],
};

function packageEvidence(kind, generation) {
  const id = `${kind}${generation}`;
  const expected = PHASE_3_COMPATIBILITY_DEFINITION.packages[id];
  const packageName = kind === "kit" ? "visp-kit" : "visp-hyper-agent";
  const bin = kind === "kit" ? "visp" : "visp-hyper";
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
      first: { sha256: PACKAGE_HASHES[id] },
      second: { sha256: PACKAGE_HASHES[id] },
    },
    runtimeLock: {
      materializedSha256: "c".repeat(64),
      templateSha256: "d".repeat(64),
    },
    source: structuredClone(expected),
  };
}

function actionView(definition) {
  const available = definition.summaryState === "available";
  const decisionHash = definition.reviewStatus === "missing"
    || definition.reviewStatus === "invalid"
    ? null
    : `sha256:${sha256Hex(`decision-${definition.id}`)}`;
  const assuranceSummary = available
    ? {
        artifact: {
          contentHash: `sha256:${"1".repeat(64)}`,
          path: `.visp/features/001-phase-3/assurance/T001/assurance-case.json`,
        },
        caseHash: `sha256:${sha256Hex(`case-${definition.id}`)}`,
        mandatoryHotspots: SCENARIO_HOTSPOTS[definition.id].map(([id, category]) => ({
          category,
          id,
          path: null,
          reason: `Kit reported required ${category} review.`,
          severity: category === "permissions" ? "critical" : "medium",
        })),
        reviewDecision: {
          decisionHash,
          reason: `Kit reported ${definition.reviewStatus}.`,
          required: true,
          status: definition.reviewStatus,
        },
        state: "available",
        verdict: definition.assuranceVerdict,
        version: "1.0",
      }
    : {
        reason: "Kit could not produce a current assurance case.",
        reviewDecision: {
          decisionHash: null,
          reason: "Kit reported invalid.",
          required: true,
          status: "invalid",
        },
        state: "unavailable",
      };
  return {
    actionId: `sha256:${sha256Hex(`action-${definition.id}`)}`,
    actionVerdict: definition.id === "critical_stale" ? "inconclusive" : "ready",
    assuranceSummary,
    assuranceVerdict: available ? definition.assuranceVerdict : null,
    caseHash: available ? assuranceSummary.caseHash : null,
    mandatoryHotspots: available ? structuredClone(assuranceSummary.mandatoryHotspots) : [],
    nextCommand: "visp verify --task T001",
    protocolVersion: "3.2",
    reviewDecision: structuredClone(assuranceSummary.reviewDecision),
    schemaHash: PHASE_3_COMPATIBILITY_DEFINITION.schemaHash,
  };
}

function completeInput() {
  return {
    compatibility: PHASE_3_COMPATIBILITY_DEFINITION.compatibility.map((row) => {
      const view = {
        actionId: COMPATIBILITY_ACTION_IDS[row.id],
        actionVerdict: "ready",
        nextCommand: "visp verify --task T001",
        protocolVersion: row.expectedProtocol,
        schemaHash: row.expectedSchemaHash,
        selectionMode: "advertised",
      };
      return {
        id: row.id,
        surfaces: PHASE_3_COMPATIBILITY_DEFINITION.surfaces.map((id) => ({
          id,
          view: structuredClone(view),
        })),
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
    packages: {
      hyperNew: packageEvidence("hyper", "New"),
      hyperOld: packageEvidence("hyper", "Old"),
      kitNew: packageEvidence("kit", "New"),
      kitOld: packageEvidence("kit", "Old"),
    },
    scenarios: PHASE_3_COMPATIBILITY_DEFINITION.scenarios.map((definition) => {
      const kit = actionView(definition);
      return {
        flow: definition.flow,
        id: definition.id,
        kit,
        profile: definition.profile,
        surfaces: PHASE_3_COMPATIBILITY_DEFINITION.surfaces.map((id) => ({
          id,
          view: structuredClone(kit),
        })),
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

test("Phase 3 definition pins exact producers, 3.2 trust, additive boundary, and golden flows", () => {
  assert.deepEqual(PHASE_3_COMPATIBILITY_DEFINITION.packages, {
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
    PHASE_3_COMPATIBILITY_DEFINITION.schemaHash,
    "sha256:77dcaba51ef8e1a78064680077f8bcc48c081d8025596c6cc8df9ea7873d68e9",
  );
  assert.deepEqual(
    PHASE_3_COMPATIBILITY_DEFINITION.compatibility.map(
      ({ id, expectedProtocol }) => [id, expectedProtocol],
    ),
    [
      ["new_kit_old_hyper", "3.1"],
      ["old_kit_new_hyper", "3.1"],
      ["new_kit_new_hyper", "3.2"],
    ],
  );
  assert.deepEqual(
    PHASE_3_COMPATIBILITY_DEFINITION.scenarios.map(
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
  assert.equal(Object.isFrozen(PHASE_3_COMPATIBILITY_DEFINITION), true);
  assert.match(PHASE_3_COMPATIBILITY_SHA256, HASH);
});

test("Phase 3 report is deterministic, self-hashed, and preserves Kit facts on all surfaces", () => {
  const first = createPhase3CompatibilityReport(completeInput());
  const second = createPhase3CompatibilityReport(completeInput());
  assert.deepEqual(first, second);
  assert.equal(verifyPhase3CompatibilityReport(first), true);
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

test("Phase 3 verifier rejects coordinated semantic rewrites across Kit and every Hyper surface", () => {
  const report = createPhase3CompatibilityReport(completeInput());
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
    assert.throws(() => verifyPhase3CompatibilityReport(candidate));
  }
});

test("Phase 3 verifier rejects producer, protocol, assurance, surface, provenance, and hash drift", () => {
  const report = createPhase3CompatibilityReport(completeInput());
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
    assert.throws(() => verifyPhase3CompatibilityReport(candidate));
  }
  const invalidHash = structuredClone(report);
  invalidHash.reportSha256 = "0".repeat(64);
  assert.throws(() => verifyPhase3CompatibilityReport(invalidHash));
});
