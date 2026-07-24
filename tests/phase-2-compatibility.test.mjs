import assert from "node:assert/strict";
import test from "node:test";

import { canonicalStringify, sha256Hex } from "../src/compatibility-lab.mjs";
import {
  PHASE_2_COMPATIBILITY_DEFINITION,
  PHASE_2_COMPATIBILITY_SHA256,
  createPhase2CompatibilityReport,
  verifyPhase2CompatibilityReport,
} from "../src/phase-2-compatibility.mjs";

const HASH = /^[0-9a-f]{64}$/u;

function packageEvidence(kind) {
  const expected = PHASE_2_COMPATIBILITY_DEFINITION.pair[kind];
  return {
    install: {
      bins: [{
        name: kind === "kit" ? "visp" : "visp-hyper",
        sha256: "a".repeat(64),
        target: `node_modules/${kind === "kit" ? "visp-kit" : "visp-hyper-agent"}/dist/index.js`,
      }],
      lifecycleScriptsDisabled: true,
      offline: true,
    },
    pack: {
      byteEquality: true,
      first: { sha256: "b".repeat(64) },
      second: { sha256: "b".repeat(64) },
    },
    runtimeLock: {
      materializedSha256: "c".repeat(64),
      templateSha256: "d".repeat(64),
    },
    source: { commit: expected.commit, tree: expected.tree },
  };
}

function profileEvidence(definition) {
  const artifact = (suffix) => ({
    path: `.visp/features/001-phase-2/assurance/${definition.taskId}/${suffix}.json`,
    sha256: `sha256:${definition.taskId.at(-1).repeat(64)}`,
  });
  const evidence = {
    freshness: "fresh",
    outcome: "passed",
    providers: [{
      results: [{
        freshness: "fresh",
        independence: definition.testIndependence,
        status: "passed",
      }],
      status: "passed",
    }],
    source: "candidate",
  };
  const view = {
    actionId: `sha256:${sha256Hex(`kit-${definition.profile}`)}`,
    evidence: structuredClone(evidence),
    profile: definition.profile,
    protocolVersion: "3.1",
    schemaHash: `sha256:${PHASE_2_COMPATIBILITY_DEFINITION.schemaHash}`,
  };
  return {
    artifacts: {
      baseline: artifact("baseline-evidence"),
      candidate: artifact("candidate-evidence"),
      lock: artifact("oracle-lock"),
      plan: artifact("oracle-plan"),
    },
    humanApproval: definition.humanApproval,
    id: definition.id,
    kit: view,
    profile: definition.profile,
    surfaces: PHASE_2_COMPATIBILITY_DEFINITION.surfaces.map((surface) => ({
      actionId: view.actionId,
      evidence: structuredClone(evidence),
      id: surface,
      profile: definition.profile,
      protocolVersion: "3.1",
      schemaHash: `sha256:${PHASE_2_COMPATIBILITY_DEFINITION.schemaHash}`,
    })),
    taskId: definition.taskId,
  };
}

function completeInput() {
  return {
    environment: {
      architecture: "x64",
      git: "git version 2.49.0",
      node: "v24.15.0",
      npm: "11.12.1",
      operatingSystem: "linux",
      pnpm: "11.3.0",
    },
    packages: {
      hyper: packageEvidence("hyper"),
      kit: packageEvidence("kit"),
    },
    profiles: PHASE_2_COMPATIBILITY_DEFINITION.profiles.map(profileEvidence),
  };
}

function rehash(report) {
  delete report.reportSha256;
  report.reportSha256 = sha256Hex(canonicalStringify(report));
}

test("Phase 2 definitions pin the exact packed pair, schema, profiles, and six surfaces", () => {
  assert.deepEqual(PHASE_2_COMPATIBILITY_DEFINITION.pair, {
    hyper: {
      commit: "98b65d05a10766cb66b1caa9cb7ae3c5c589137d",
      tree: "34bb04ed2454e389f7aca7bea76fd05ab81f264c",
    },
    kit: {
      commit: "3dbc9184e8ee4bb7d1599aa825bfd2ed57b384d8",
      tree: "6b5a45bed9f97007490f553c0d6d3af81be8ae2e",
    },
  });
  assert.equal(
    PHASE_2_COMPATIBILITY_DEFINITION.schemaHash,
    "41ffa28fcd4476ea1812ff307df67a7ab7edb5b2cf4d6c11955d34d4aad74d4d",
  );
  assert.deepEqual(
    PHASE_2_COMPATIBILITY_DEFINITION.profiles.map(({ profile }) => profile),
    ["routine", "behavioral", "critical"],
  );
  assert.deepEqual(
    PHASE_2_COMPATIBILITY_DEFINITION.profiles.map(({ testIndependence, humanApproval }) => [
      testIndependence,
      humanApproval,
    ]),
    [["pre_existing", false], ["pre_approved", false], ["pre_approved", true]],
  );
  assert.deepEqual(PHASE_2_COMPATIBILITY_DEFINITION.surfaces, [
    "run",
    "next",
    "resume",
    "checkpoint",
    "guard",
    "mcp",
  ]);
  assert.match(PHASE_2_COMPATIBILITY_SHA256, HASH);
  assert.equal(Object.isFrozen(PHASE_2_COMPATIBILITY_DEFINITION), true);
});

test("Phase 2 report is deterministic, hash-verified, and proves candidate evidence on every surface", () => {
  const first = createPhase2CompatibilityReport(completeInput());
  const second = createPhase2CompatibilityReport(completeInput());
  assert.deepEqual(first, second);
  assert.equal(verifyPhase2CompatibilityReport(first), true);
  assert.deepEqual(first.summary, {
    profilesPassed: 3,
    surfacesPassed: 18,
    testsPassed: true,
  });
  assert.match(first.reportSha256, HASH);
  assert.doesNotMatch(
    JSON.stringify(first),
    /visp-compatibility-lab-|timestamp|generatedAt|checkedAt|duration|\/tmp\//iu,
  );
});

test("Phase 2 report verifier rejects pair, profile, evidence, surface, and hash drift", () => {
  const report = createPhase2CompatibilityReport(completeInput());
  const mutations = [
    (candidate) => { candidate.pair.kit.commit = "0".repeat(40); },
    (candidate) => { candidate.packages.hyper.pack.byteEquality = false; },
    (candidate) => { candidate.profiles[1].profile = "routine"; },
    (candidate) => { candidate.profiles[2].humanApproval = false; },
    (candidate) => { candidate.profiles[1].surfaces[0].evidence.outcome = "failed"; },
    (candidate) => { candidate.profiles[1].surfaces[0].actionId = `sha256:${"e".repeat(64)}`; },
    (candidate) => { candidate.profiles[1].surfaces[0].evidence.providers.push(
      structuredClone(candidate.profiles[1].surfaces[0].evidence.providers[0]),
    ); },
    (candidate) => { candidate.profiles[1].surfaces[0].evidence.freshness = "stale"; },
    (candidate) => { candidate.profiles[1].surfaces[0].evidence.providers[0].status = "failed"; },
    (candidate) => { candidate.profiles[1].surfaces[0].evidence.providers[0].results[0].independence = "authored"; },
    (candidate) => { candidate.profiles[0].surfaces.pop(); },
    (candidate) => { candidate.summary.surfacesPassed = 17; },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(report);
    mutate(candidate);
    rehash(candidate);
    assert.throws(() => verifyPhase2CompatibilityReport(candidate));
  }
  const invalidHash = structuredClone(report);
  invalidHash.reportSha256 = "0".repeat(64);
  assert.throws(() => verifyPhase2CompatibilityReport(invalidHash));
});
