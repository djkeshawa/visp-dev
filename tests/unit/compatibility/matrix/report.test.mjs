import assert from "node:assert/strict";
import test from "node:test";

import { canonicalStringify, sha256Hex } from "../../../../src/platform/canonical-json.mjs";
import {
  COMPATIBILITY_MATRIX_ROWS,
  COMPATIBILITY_MATRIX_SHA256,
  DELIBERATELY_UNSUPPORTED_CASES,
} from "../../../../src/compatibility/matrix/rows.mjs";
import {
  createCompatibilityMatrixReport,
  verifyCompatibilityMatrixReport,
} from "../../../../src/compatibility/matrix/report.mjs";

function packageEvidence(name, version, bin) {
  const preparation = {
    dependencyTree: { sha256: "1".repeat(64) },
    lifecycleScriptsDisabled: true,
    lockfile: { path: "pnpm-lock.yaml", sha256: "4".repeat(64) },
    offline: true,
    store: { mode: "caller_snapshot", sourceInventorySha256: "5".repeat(64) },
    tool: { name: "pnpm", pinned: "pnpm@11.3.0", version: "11.3.0" },
  };
  const pack = {
    byteSize: 1,
    memberListBytes: 1,
    memberListSha256: "c".repeat(64),
    members: ["package/package.json"],
    package: { declaredBins: [{ name: bin, path: "dist/index.js" }], name, version },
    sha256: "d".repeat(64),
    tool: { lifecycleScriptsPolicy: "required", name: "npm", version: "11.12.1" },
  };
  return {
    install: {
      bins: [{ name: bin, sha256: "a".repeat(64), target: `node_modules/${name}/dist/index.js` }],
      cache: { inventorySha256: "6".repeat(64), mode: "caller_snapshot" },
      dependencyTree: {
        sha256: "b".repeat(64),
        tree: { dependencies: [], name: "root", version: null },
      },
      installLock: { graphSha256: "7".repeat(64), sha256: "8".repeat(64) },
      lifecycleScriptsDisabled: true,
      offline: true,
      tool: { name: "npm", version: "11.12.1" },
    },
    preparations: [structuredClone(preparation), structuredClone(preparation)],
    runtimeLock: {
      localIntegrity: `sha512-${"A".repeat(88)}`,
      materializedSha256: "2".repeat(64),
      templateSha256: "3".repeat(64),
    },
    pack: { byteEquality: true, first: structuredClone(pack), second: structuredClone(pack) },
  };
}

function scenarioEvidence(id, protocolVersion) {
  const exitCode = protocolVersion === null ? 1 : 0;
  return {
    assertions: [
      { expected: true, id: "process_completed", observed: true, passed: true },
      { expected: exitCode, id: "exit_code", observed: exitCode, passed: true },
      { expected: protocolVersion, id: "protocol", observed: protocolVersion, passed: true },
    ],
    execution: {
      exitCode,
      signal: null,
      spawnError: null,
      stderr: { bytes: 0, sha256: "e".repeat(64), text: "", truncated: false },
      stdout: { bytes: 1, sha256: "f".repeat(64), text: "", truncated: false },
      timedOut: false,
    },
    id,
    passed: true,
  };
}

function completeInput() {
  const packages = {};
  for (const row of COMPATIBILITY_MATRIX_ROWS) {
    packages[row.kit.commit] ??= {
      ...packageEvidence("visp-kit", "0.1.1", "visp"),
      source: { commit: row.kit.commit, tree: row.kit.tree },
    };
    packages[row.hyper.commit] ??= {
      ...packageEvidence("visp-hyper-agent", "0.3.0", "visp-hyper"),
      source: { commit: row.hyper.commit, tree: row.hyper.tree },
    };
  }
  return {
    environment: {
      architecture: "x64",
      git: "git version 2.49.0",
      node: "v24.15.0",
      npm: "11.12.1",
      operatingSystem: "linux",
      pnpm: "11.3.0",
    },
    packages,
    rows: COMPATIBILITY_MATRIX_ROWS.map((row) => ({
      id: row.id,
      scenarios: row.scenarios.map((id) => scenarioEvidence(id, row.expectedProtocol)),
    })),
    deliberatelyUnsupported: DELIBERATELY_UNSUPPORTED_CASES.map(({ category, id, reasonCode }) => {
      const evidence = scenarioEvidence(id, null);
      evidence.assertions.pop();
      evidence.assertions.push({
        expected: reasonCode,
        id: category === "explicit_unsupported_request" ? "error_code" : "reason_code",
        observed: reasonCode,
        passed: true,
      });
      if (category !== "explicit_unsupported_request") {
        evidence.assertions.push({
          expected: true,
          id: "canonical_action_absent",
          observed: true,
          passed: true,
        });
      }
      return { ...evidence, classification: "deliberately_unsupported", rejectionObserved: true };
    }),
  };
}

function rehashReport(report) {
  delete report.reportSha256;
  report.reportSha256 = sha256Hex(canonicalStringify(report));
}

test("report creation is canonical, deterministic, and verifies every positive and negative assertion", () => {
  const first = createCompatibilityMatrixReport(completeInput());
  const second = createCompatibilityMatrixReport(completeInput());
  assert.deepEqual(first, second);
  assert.equal(first.matrixSha256, COMPATIBILITY_MATRIX_SHA256);
  assert.match(first.reportSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(first.summary, {
    deliberately_unsupported_passed: 7,
    positive_rows_passed: 5,
    tests_passed: true,
  });
  assert.equal(verifyCompatibilityMatrixReport(first), true);
  assert.doesNotMatch(
    JSON.stringify(first),
    /timestamp|duration|visp-compatibility-lab-|pr_readiness/iu,
  );
});

test("verification fails closed on pair drift, missing evidence, overclaims, and negative support claims", () => {
  const report = createCompatibilityMatrixReport(completeInput());
  const mutations = [
    (candidate) => { candidate.rows[0].kit.commit = "0".repeat(40); },
    (candidate) => {
      candidate.packages[COMPATIBILITY_MATRIX_ROWS[0].kit.commit].pack.second.sha256 = "0".repeat(64);
    },
    (candidate) => {
      candidate.rows[3].canonicalSurfaces = ["run", "next", "resume", "checkpoint", "guard", "mcp"];
    },
    (candidate) => { candidate.deliberatelyUnsupported[0].classification = "supported"; },
    (candidate) => { candidate.deliberatelyUnsupported[0].rejectionObserved = false; },
    (candidate) => { candidate.rows[4].scenarios.pop(); },
    (candidate) => {
      candidate.rows[0].scenarios[0].assertions.at(-1).observed = "forged";
      candidate.rows[0].scenarios[0].assertions.at(-1).passed = true;
    },
    (candidate) => { candidate.rows[0].scenarios[0].execution.exitCode = 99; },
    (candidate) => {
      candidate.packages[COMPATIBILITY_MATRIX_ROWS[0].kit.commit].preparations[1]
        .dependencyTree.sha256 = "9".repeat(64);
    },
    (candidate) => {
      candidate.packages[COMPATIBILITY_MATRIX_ROWS[0].kit.commit].install.offline = false;
    },
    (candidate) => {
      const reason = candidate.deliberatelyUnsupported[0].assertions
        .find(({ id }) => id === "reason_code");
      reason.expected = "unrelated_block";
      reason.observed = "unrelated_block";
      reason.passed = true;
    },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(report);
    mutate(candidate);
    rehashReport(candidate);
    assert.throws(() => verifyCompatibilityMatrixReport(candidate));
  }
  const invalidHash = structuredClone(report);
  invalidHash.reportSha256 = "0".repeat(64);
  assert.throws(() => verifyCompatibilityMatrixReport(invalidHash));
});
