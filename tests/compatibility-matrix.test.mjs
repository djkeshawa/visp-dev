import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  COMPATIBILITY_MATRIX_SHA256,
  COMPATIBILITY_MATRIX_ROWS,
  DELIBERATELY_UNSUPPORTED_CASES,
  createCompatibilityMatrixReport,
  materializeRuntimeInstallLock,
  selectCompatibilityMatrixRows,
  stableExecutionEvidence,
  verifyCompatibilityMatrixReport,
} from "../src/compatibility-matrix.mjs";
import { canonicalStringify, sha256Hex } from "../src/compatibility-lab.mjs";

const exactPairs = [
  ["0a8026ca129cdb9ec8ba516a2e30aaf135d5d4a0", "d4444da8f862dc229f6832c6bc89820df466d213"],
  ["c03a2dd0838501f4c4e480a69171848d3f2c0499", "d4444da8f862dc229f6832c6bc89820df466d213"],
  ["706c1ec348b9de8a51651d1c8e9587feb1962fd8", "d4444da8f862dc229f6832c6bc89820df466d213"],
  ["706c1ec348b9de8a51651d1c8e9587feb1962fd8", "17f01e4295258ec55c4c74cb47dcfdbb66981dce"],
  ["d85adbdac5dac85bea112c857967c067cb1708a9", "2bf636f58517780256cd91089440fb3b2f501480"],
];

test("matrix definitions freeze the exact five honest positive pairs and bounded negative corpus", () => {
  assert.deepEqual(
    COMPATIBILITY_MATRIX_ROWS.map(({ kit, hyper }) => [kit.commit, hyper.commit]),
    exactPairs,
  );
  assert.deepEqual(COMPATIBILITY_MATRIX_ROWS.map(({ id }) => id), ["A", "B", "C", "D", "E"]);
  assert.deepEqual(COMPATIBILITY_MATRIX_ROWS.map(({ expectedProtocol }) => expectedProtocol), [
    "2.0",
    "2.0",
    "2.0",
    "3.0",
    "3.0",
  ]);
  assert.equal(COMPATIBILITY_MATRIX_ROWS[3].canonicalSurfaces, null);
  assert.deepEqual(COMPATIBILITY_MATRIX_ROWS[3].scenarios, [
    "doctor_negotiated_v3",
    "historical_strict_next_v2",
  ]);
  assert.deepEqual(COMPATIBILITY_MATRIX_ROWS[4].canonicalSurfaces, [
    "run",
    "next",
    "resume",
    "checkpoint",
    "guard",
    "mcp",
  ]);
  assert.deepEqual(DELIBERATELY_UNSUPPORTED_CASES.map(({ category }) => category), [
    "future_protocol",
    "malformed_advertisement",
    "schema_hash_mismatch",
    "malformed_action",
    "wrong_returned_protocol",
    "semantic_contradiction",
    "explicit_unsupported_request",
  ]);
});

test("exact row selection supports bounded debug reruns without broadening pair scope", () => {
  assert.deepEqual(selectCompatibilityMatrixRows("A").map(({ id }) => id), ["A"]);
  assert.deepEqual(selectCompatibilityMatrixRows("E").map(({ id }) => id), ["E"]);
  assert.deepEqual(selectCompatibilityMatrixRows().map(({ id }) => id), ["A", "B", "C", "D", "E"]);
  assert.throws(() => selectCompatibilityMatrixRows("A,E"), /one exact matrix row/i);
  assert.throws(() => selectCompatibilityMatrixRows("F"), /one exact matrix row/i);
});

test("one closed runtime lock template materializes exact packed local identity and bins", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "visp matrix lock "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tarballPath = path.join(root, "package.tgz");
  const outputPath = path.join(root, "package-lock.json");
  await writeFile(tarballPath, "packed bytes");
  const result = await materializeRuntimeInstallLock({
    outputPath,
    package: {
      declaredBins: [{ name: "visp", path: "dist/index.js" }],
      name: "visp-kit",
      version: "0.1.1",
    },
    tarballPath,
  });
  const lock = JSON.parse(await readFile(outputPath, "utf8"));
  assert.deepEqual(lock.packages[""].dependencies, {
    "visp-kit": "file:__VISP_LOCAL_TARBALL__",
  });
  assert.deepEqual(lock.packages["node_modules/visp-kit"], {
    bin: { visp: "dist/index.js" },
    dependencies: { commander: "^12.1.0", zod: "^3.25.76" },
    integrity: result.localIntegrity,
    resolved: "file:__VISP_LOCAL_TARBALL__",
    version: "0.1.1",
  });
  assert.match(result.templateSha256, /^[0-9a-f]{64}$/);
  assert.match(result.materializedSha256, /^[0-9a-f]{64}$/);
});

function packageEvidence(name, version, bin) {
  const preparation = {
    dependencyTree: { sha256: "1".repeat(64) },
    lifecycleScriptsDisabled: true,
    lockfile: { path: "pnpm-lock.yaml", sha256: "4".repeat(64) },
    offline: true,
    store: { mode: "caller_snapshot", sourceInventorySha256: "5".repeat(64) },
    tool: { name: "pnpm", pinned: "pnpm@11.3.0", version: "11.3.0" },
  };
  return {
    install: {
      bins: [{ name: bin, sha256: "a".repeat(64), target: `node_modules/${name}/dist/index.js` }],
      cache: { inventorySha256: "6".repeat(64), mode: "caller_snapshot" },
      dependencyTree: { sha256: "b".repeat(64), tree: { dependencies: [], name: "root", version: null } },
      installLock: {
        graphSha256: "7".repeat(64),
        sha256: "8".repeat(64),
      },
      lifecycleScriptsDisabled: true,
      offline: true,
      tool: { name: "npm", version: "11.12.1" },
    },
    preparations: [
      structuredClone(preparation),
      structuredClone(preparation),
    ],
    runtimeLock: {
      localIntegrity: `sha512-${"A".repeat(88)}`,
      materializedSha256: "2".repeat(64),
      templateSha256: "3".repeat(64),
    },
    pack: {
      byteEquality: true,
      first: {
        byteSize: 1,
        memberListBytes: 1,
        memberListSha256: "c".repeat(64),
        members: ["package/package.json"],
        package: { declaredBins: [{ name: bin, path: "dist/index.js" }], name, version },
        sha256: "d".repeat(64),
        tool: { lifecycleScriptsPolicy: "required", name: "npm", version: "11.12.1" },
      },
      second: {
        byteSize: 1,
        memberListBytes: 1,
        memberListSha256: "c".repeat(64),
        members: ["package/package.json"],
        package: { declaredBins: [{ name: bin, path: "dist/index.js" }], name, version },
        sha256: "d".repeat(64),
        tool: { lifecycleScriptsPolicy: "required", name: "npm", version: "11.12.1" },
      },
    },
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
      return {
        ...evidence,
        classification: "deliberately_unsupported",
        rejectionObserved: true,
      };
    }),
  };
}

function rehashReport(report) {
  delete report.reportSha256;
  report.reportSha256 = sha256Hex(canonicalStringify(report));
}

test("execution evidence normalizes owned paths before hashing", () => {
  const result = (ownedRoot) => ({
    exitCode: 0,
    signal: null,
    spawnError: null,
    stderr: {
      bytes: 0,
      sha256: "0".repeat(64),
      text: "",
      truncated: false,
    },
    stdout: {
      bytes: 0,
      sha256: "0".repeat(64),
      text: `project=${ownedRoot}/row/project\n`,
      truncated: false,
    },
    timedOut: false,
  });
  const first = stableExecutionEvidence(result("/tmp/first-random-root"), ["/tmp/first-random-root"]);
  const second = stableExecutionEvidence(result("/tmp/second-random-root"), ["/tmp/second-random-root"]);
  assert.deepEqual(first, second);
  assert.equal(first.stdout.bytes, Buffer.byteLength("project=<VISP_MATRIX_OWNED_ROOT>/row/project\n"));
  assert.equal(first.stdout.sha256, sha256Hex("project=<VISP_MATRIX_OWNED_ROOT>/row/project\n"));
});

test("report creation is canonical, deterministic, and verifies all positive and negative assertions", () => {
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
  const rendered = JSON.stringify(first);
  assert.doesNotMatch(rendered, /timestamp|duration|visp-compatibility-lab-|pr_readiness/i);
});

test("report verification fails closed on pair drift, missing evidence, overclaims, and negative support claims", () => {
  const report = createCompatibilityMatrixReport(completeInput());
  const mutations = [
    (candidate) => { candidate.rows[0].kit.commit = "0".repeat(40); },
    (candidate) => { candidate.packages[COMPATIBILITY_MATRIX_ROWS[0].kit.commit].pack.second.sha256 = "0".repeat(64); },
    (candidate) => { candidate.rows[3].canonicalSurfaces = ["run", "next", "resume", "checkpoint", "guard", "mcp"]; },
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
      const reason = candidate.deliberatelyUnsupported[0].assertions.find(({ id }) => id === "reason_code");
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
