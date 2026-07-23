import { createHash } from "node:crypto";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  canonicalStringify,
  cleanupOwnedRoot,
  createOwnedRoot,
  installLocalTarball,
  packPackageTwice,
  runProcess,
  sha256Hex,
} from "./compatibility-lab.mjs";

const HASH = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const POSITIVE_SURFACES = ["run", "next", "resume", "checkpoint", "guard", "mcp"];
const DEFAULT_RUNTIME_LOCK_TEMPLATE = fileURLToPath(
  new URL("../fixtures/runtime-lock-template.json", import.meta.url),
);

export const COMPATIBILITY_MATRIX_ROWS = deepFreeze([
  {
    id: "A",
    kit: {
      commit: "0a8026ca129cdb9ec8ba516a2e30aaf135d5d4a0",
      tree: "7512dd5187b88708c98def54ee94b1b774de61d9",
    },
    hyper: {
      commit: "d4444da8f862dc229f6832c6bc89820df466d213",
      tree: "c548560bb0feecea5dc2032ec5b5ac5791ea9ab3",
    },
    expectedProtocol: "2.0",
    selection: "selectorless_default",
    scenarios: ["kit_selectorless_v2", "hyper_selectorless_v2", "no_protocol_advertisement"],
    canonicalSurfaces: null,
  },
  {
    id: "B",
    kit: {
      commit: "c03a2dd0838501f4c4e480a69171848d3f2c0499",
      tree: "c32f84f58eda4d5efde702e424d6e2b6406144f5",
    },
    hyper: {
      commit: "d4444da8f862dc229f6832c6bc89820df466d213",
      tree: "c548560bb0feecea5dc2032ec5b5ac5791ea9ab3",
    },
    expectedProtocol: "2.0",
    selection: "selectorless_default",
    scenarios: ["kit_selectorless_v2", "kit_explicit_v3", "hyper_selectorless_v2"],
    canonicalSurfaces: null,
  },
  {
    id: "C",
    kit: {
      commit: "706c1ec348b9de8a51651d1c8e9587feb1962fd8",
      tree: "7228012509bd4c165f30c9460fd235f1cdbadfbb",
    },
    hyper: {
      commit: "d4444da8f862dc229f6832c6bc89820df466d213",
      tree: "c548560bb0feecea5dc2032ec5b5ac5791ea9ab3",
    },
    expectedProtocol: "2.0",
    selection: "selectorless_default",
    scenarios: ["kit_advertises_v2_v3", "hyper_selectorless_v2", "advertisement_tolerated"],
    canonicalSurfaces: null,
  },
  {
    id: "D",
    kit: {
      commit: "706c1ec348b9de8a51651d1c8e9587feb1962fd8",
      tree: "7228012509bd4c165f30c9460fd235f1cdbadfbb",
    },
    hyper: {
      commit: "17f01e4295258ec55c4c74cb47dcfdbb66981dce",
      tree: "52c098d4d52c8d2c23fe17a34c671d42048f1117",
    },
    expectedProtocol: "3.0",
    selection: "advertised_auto",
    scenarios: ["doctor_negotiated_v3", "historical_strict_next_v2"],
    canonicalSurfaces: null,
  },
  {
    id: "E",
    kit: {
      commit: "d85adbdac5dac85bea112c857967c067cb1708a9",
      tree: "cb12729f54d1ff2fbcc818bb4c487691983cfa6a",
    },
    hyper: {
      commit: "2bf636f58517780256cd91089440fb3b2f501480",
      tree: "0080f3e351372a5f8b40864dd6653ee2a1e4e88e",
    },
    expectedProtocol: "3.0",
    selection: "advertised_auto",
    scenarios: [
      "kit_selectorless_legacy_v2",
      "kit_explicit_v2",
      "hyper_auto_v3",
      "surface_run",
      "surface_next",
      "surface_resume",
      "surface_checkpoint",
      "surface_guard",
      "surface_mcp",
    ],
    canonicalSurfaces: POSITIVE_SURFACES,
  },
]);

export const DELIBERATELY_UNSUPPORTED_CASES = deepFreeze([
  {
    id: "future_protocol_rejected",
    category: "future_protocol",
    reasonCode: "workflow_action_no_mutual_protocol",
  },
  {
    id: "malformed_advertisement_rejected",
    category: "malformed_advertisement",
    reasonCode: "workflow_action_advertisement_invalid",
  },
  {
    id: "schema_hash_mismatch_rejected",
    category: "schema_hash_mismatch",
    reasonCode: "workflow_action_schema_hash_mismatch",
  },
  {
    id: "malformed_action_rejected",
    category: "malformed_action",
    reasonCode: "workflow_action_schema_invalid",
  },
  {
    id: "wrong_returned_protocol_rejected",
    category: "wrong_returned_protocol",
    reasonCode: "workflow_action_protocol_mismatch",
  },
  {
    id: "semantic_contradiction_rejected",
    category: "semantic_contradiction",
    reasonCode: "workflow_action_contradiction",
  },
  {
    id: "explicit_unsupported_request_rejected",
    category: "explicit_unsupported_request",
    reasonCode: "UNSUPPORTED_WORKFLOW_ACTION_PROTOCOL",
  },
]);

export const COMPATIBILITY_MATRIX_SHA256 = sha256Hex(canonicalStringify({
  deliberatelyUnsupported: DELIBERATELY_UNSUPPORTED_CASES,
  rows: COMPATIBILITY_MATRIX_ROWS,
}));

export function selectCompatibilityMatrixRows(row = null) {
  if (row === null) return COMPATIBILITY_MATRIX_ROWS;
  if (typeof row !== "string" || !/^[A-E]$/u.test(row)) {
    throw new TypeError("row must be one exact matrix row ID from A through E");
  }
  return COMPATIBILITY_MATRIX_ROWS.filter(({ id }) => id === row);
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export async function materializeRuntimeInstallLock({
  outputPath,
  package: packageIdentity,
  tarballPath,
  templatePath = DEFAULT_RUNTIME_LOCK_TEMPLATE,
}) {
  const templateBytes = await readFile(templatePath);
  const template = JSON.parse(templateBytes.toString("utf8"));
  const localKey = "node_modules/__VISP_LOCAL_NAME__";
  const local = template.packages?.[localKey];
  const root = template.packages?.[""];
  if (template.name !== "visp-compatibility-install"
    || template.lockfileVersion !== 3
    || template.requires !== true
    || canonicalStringify(root?.dependencies) !== canonicalStringify({
      __VISP_LOCAL_NAME__: "file:__VISP_LOCAL_TARBALL__",
    })
    || local?.version !== "__VISP_LOCAL_VERSION__"
    || local?.resolved !== "file:__VISP_LOCAL_TARBALL__"
    || local?.integrity !== "__VISP_LOCAL_INTEGRITY__"
    || canonicalStringify(local?.dependencies) !== canonicalStringify({
      commander: "^12.1.0",
      zod: "^3.25.76",
    })
    || canonicalStringify(local?.bin) !== canonicalStringify({
      __VISP_LOCAL_BIN_NAME__: "__VISP_LOCAL_BIN_PATH__",
    })) {
    throw new Error("Runtime lock template does not match its closed sentinel contract");
  }
  if (!packageIdentity
    || typeof packageIdentity.name !== "string"
    || typeof packageIdentity.version !== "string"
    || !Array.isArray(packageIdentity.declaredBins)
    || packageIdentity.declaredBins.length !== 1) {
    throw new Error("Packed package identity cannot materialize the runtime lock");
  }
  const [bin] = packageIdentity.declaredBins;
  if (typeof bin.name !== "string" || typeof bin.path !== "string") {
    throw new Error("Packed package bin identity cannot materialize the runtime lock");
  }
  const tarballBytes = await readFile(tarballPath);
  const localIntegrity = `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`;
  delete template.packages[localKey];
  root.dependencies = {
    [packageIdentity.name]: "file:__VISP_LOCAL_TARBALL__",
  };
  template.packages[`node_modules/${packageIdentity.name}`] = {
    bin: { [bin.name]: bin.path },
    dependencies: structuredClone(local.dependencies),
    integrity: localIntegrity,
    resolved: "file:__VISP_LOCAL_TARBALL__",
    version: packageIdentity.version,
  };
  const materialized = canonicalStringify(template);
  await writeFile(outputPath, materialized, { flag: "wx", mode: 0o600 });
  return {
    localIntegrity,
    materializedSha256: sha256Hex(materialized),
    templateSha256: sha256Hex(templateBytes),
  };
}

function plain(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  plain(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalStringify(actual) !== canonicalStringify(expected)) {
    throw new Error(`${label} has an unexpected field set`);
  }
}

function exactArray(value, expected, label) {
  if (!Array.isArray(value)
    || canonicalStringify(value) !== canonicalStringify(expected)) {
    throw new Error(`${label} does not match the frozen matrix`);
  }
}

function validateOutput(output, label) {
  exactKeys(output, ["bytes", "sha256", "text", "truncated"], label);
  if (!Number.isInteger(output.bytes) || output.bytes < 0
    || !HASH.test(output.sha256)
    || typeof output.text !== "string"
    || typeof output.truncated !== "boolean") {
    throw new Error(`${label} is malformed`);
  }
}

function validateExecution(execution, label) {
  exactKeys(
    execution,
    ["exitCode", "signal", "spawnError", "stderr", "stdout", "timedOut"],
    label,
  );
  if (!(execution.exitCode === null || Number.isInteger(execution.exitCode))
    || !(execution.signal === null || typeof execution.signal === "string")
    || !(execution.spawnError === null || typeof execution.spawnError === "object")
    || typeof execution.timedOut !== "boolean") {
    throw new Error(`${label} is malformed`);
  }
  validateOutput(execution.stdout, `${label}.stdout`);
  validateOutput(execution.stderr, `${label}.stderr`);
  if (execution.stdout.truncated || execution.stderr.truncated) {
    throw new Error(`${label} cannot prove assertions from truncated output`);
  }
}

function validateAssertion(assertion, label) {
  exactKeys(assertion, ["expected", "id", "observed", "passed"], label);
  if (typeof assertion.id !== "string" || !/^[a-z][a-z0-9_]*$/u.test(assertion.id)) {
    throw new Error(`${label} has an invalid ID`);
  }
  const recomputed = canonicalStringify(assertion.expected) === canonicalStringify(assertion.observed);
  if (assertion.passed !== recomputed) {
    throw new Error(`${label} pass state contradicts its values`);
  }
}

function validateScenario(scenario, expectedId, label) {
  exactKeys(scenario, ["assertions", "execution", "id", "passed"], label);
  if (scenario.id !== expectedId || !Array.isArray(scenario.assertions)
    || scenario.assertions.length === 0) {
    throw new Error(`${label} did not pass its authored assertions`);
  }
  validateExecution(scenario.execution, `${label}.execution`);
  scenario.assertions.forEach((item, index) => {
    validateAssertion(item, `${label}.assertions[${index}]`);
  });
  const ids = scenario.assertions.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label} contains duplicate assertion IDs`);
  }
  const completed = scenario.assertions.find(({ id }) => id === "process_completed");
  const exitCode = scenario.assertions.find(({ id }) => id === "exit_code");
  const observedCompletion = scenario.execution.spawnError === null
    && scenario.execution.timedOut === false;
  if (!completed
    || completed.expected !== true
    || completed.observed !== observedCompletion
    || !exitCode
    || !Number.isInteger(exitCode.expected)
    || exitCode.observed !== scenario.execution.exitCode) {
    throw new Error(`${label} assertions do not match its execution evidence`);
  }
  const recomputedPass = scenario.assertions.every(({ passed }) => passed === true);
  if (scenario.passed !== recomputedPass || scenario.passed !== true) {
    throw new Error(`${label} did not pass its recomputed assertions`);
  }
}

function validatePackage(record, expected, environment, label) {
  exactKeys(record, ["install", "pack", "preparations", "runtimeLock", "source"], label);
  exactKeys(record.source, ["commit", "tree"], `${label} source`);
  if (record.source.commit !== expected.commit || record.source.tree !== expected.tree) {
    throw new Error(`${label} source identity drifted`);
  }
  if (!COMMIT.test(record.source.commit) || !COMMIT.test(record.source.tree)) {
    throw new Error(`${label} source identity is malformed`);
  }
  const expectedName = label.includes("kit") ? "visp-kit" : "visp-hyper-agent";
  const expectedVersion = label.includes("kit") ? "0.1.1" : "0.3.0";
  const expectedBin = label.includes("kit") ? "visp" : "visp-hyper";
  const { first, second } = record.pack;
  if (record.pack.byteEquality !== true
    || canonicalStringify(first) !== canonicalStringify(second)
    || first.tool?.name !== "npm"
    || first.tool?.version !== environment.npm
    || first.tool?.lifecycleScriptsPolicy !== "required"
    || first.package.name !== expectedName
    || first.package.version !== expectedVersion
    || canonicalStringify(first.package.declaredBins.map(({ name }) => name)) !== canonicalStringify([expectedBin])
    || !HASH.test(first.sha256)
    || !HASH.test(first.memberListSha256)
    || !Array.isArray(first.members)
    || first.members.length === 0) {
    throw new Error(`${label} duplicate pack evidence is invalid`);
  }
  if (!record.install || record.install.offline !== true
    || record.install.lifecycleScriptsDisabled !== true
    || record.install.tool?.name !== "npm"
    || record.install.tool?.version !== environment.npm
    || record.install.cache?.mode !== "caller_snapshot"
    || record.install.installLock === null
    || typeof record.install.installLock !== "object"
    || !HASH.test(record.install.installLock.sha256)
    || !HASH.test(record.install.installLock.graphSha256)
    || !record.install.dependencyTree
    || !HASH.test(record.install.dependencyTree.sha256)
    || !Array.isArray(record.install.bins)
    || canonicalStringify(record.install.bins.map(({ name }) => name)) !== canonicalStringify([expectedBin])
    || record.install.bins[0].target !== `node_modules/${expectedName}/dist/index.js`
    || !HASH.test(record.install.bins[0].sha256)) {
    throw new Error(`${label} installed package evidence is invalid`);
  }
  if (!Array.isArray(record.preparations)
    || record.preparations.length !== 2
    || canonicalStringify(record.preparations[0]) !== canonicalStringify(record.preparations[1])
    || record.preparations.some((preparation) => !preparation?.dependencyTree
      || !HASH.test(preparation.dependencyTree.sha256)
      || preparation.offline !== true
      || preparation.lifecycleScriptsDisabled !== true
      || preparation.tool?.name !== "pnpm"
      || preparation.tool?.pinned !== "pnpm@11.3.0"
      || preparation.tool?.version !== environment.pnpm
      || preparation.store?.mode !== "caller_snapshot"
      || !HASH.test(preparation.store.sourceInventorySha256)
      || !HASH.test(preparation.lockfile?.sha256))) {
    throw new Error(`${label} preparation evidence is invalid`);
  }
  exactKeys(
    record.runtimeLock,
    ["localIntegrity", "materializedSha256", "templateSha256"],
    `${label} runtime lock`,
  );
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(record.runtimeLock.localIntegrity)
    || !HASH.test(record.runtimeLock.materializedSha256)
    || !HASH.test(record.runtimeLock.templateSha256)) {
    throw new Error(`${label} runtime lock evidence is invalid`);
  }
}

export function createCompatibilityMatrixReport(input) {
  plain(input, "matrix input");
  const report = {
    deliberatelyUnsupported: structuredClone(input.deliberatelyUnsupported),
    environment: structuredClone(input.environment),
    matrixSha256: COMPATIBILITY_MATRIX_SHA256,
    packages: structuredClone(input.packages),
    rows: COMPATIBILITY_MATRIX_ROWS.map((definition) => {
      const evidence = input.rows.find(({ id }) => id === definition.id);
      if (!evidence) throw new Error(`Missing matrix row ${definition.id}`);
      return {
        canonicalSurfaces: definition.canonicalSurfaces,
        expectedProtocol: definition.expectedProtocol,
        hyper: definition.hyper,
        id: definition.id,
        kit: definition.kit,
        scenarios: structuredClone(evidence.scenarios),
        selection: definition.selection,
        supportedPair: true,
      };
    }),
    schemaVersion: "visp.compatibility-matrix.evidence.v1",
    summary: {
      deliberately_unsupported_passed: input.deliberatelyUnsupported.filter(
        ({ passed, rejectionObserved }) => passed === true && rejectionObserved === true,
      ).length,
      positive_rows_passed: input.rows.filter(
        ({ scenarios }) => scenarios.every(({ passed }) => passed === true),
      ).length,
      tests_passed: true,
    },
  };
  report.reportSha256 = sha256Hex(canonicalStringify(report));
  verifyCompatibilityMatrixReport(report);
  return JSON.parse(canonicalStringify(report));
}

export function verifyCompatibilityMatrixReport(report) {
  exactKeys(
    report,
    [
      "deliberatelyUnsupported",
      "environment",
      "matrixSha256",
      "packages",
      "reportSha256",
      "rows",
      "schemaVersion",
      "summary",
    ],
    "matrix report",
  );
  if (report.schemaVersion !== "visp.compatibility-matrix.evidence.v1") {
    throw new Error("Unsupported matrix evidence schema");
  }
  if (report.matrixSha256 !== COMPATIBILITY_MATRIX_SHA256 || !HASH.test(report.reportSha256)) {
    throw new Error("Matrix evidence identity is invalid");
  }
  const unhashed = structuredClone(report);
  delete unhashed.reportSha256;
  if (report.reportSha256 !== sha256Hex(canonicalStringify(unhashed))) {
    throw new Error("Matrix evidence hash does not match its content");
  }
  exactKeys(
    report.environment,
    ["architecture", "git", "node", "npm", "operatingSystem", "pnpm"],
    "matrix environment",
  );
  for (const value of Object.values(report.environment)) {
    if (typeof value !== "string" || value.length === 0) throw new Error("Matrix environment is incomplete");
  }
  const packageExpectations = new Map();
  for (const row of COMPATIBILITY_MATRIX_ROWS) {
    packageExpectations.set(row.kit.commit, { kind: "kit", source: row.kit });
    packageExpectations.set(row.hyper.commit, { kind: "hyper", source: row.hyper });
  }
  exactArray(Object.keys(report.packages).sort(), [...packageExpectations.keys()].sort(), "matrix packages");
  for (const [commit, expected] of packageExpectations) {
    validatePackage(
      report.packages[commit],
      expected.source,
      report.environment,
      `matrix ${expected.kind} package ${commit}`,
    );
  }
  if (!Array.isArray(report.rows) || report.rows.length !== COMPATIBILITY_MATRIX_ROWS.length) {
    throw new Error("Matrix report must contain exactly five rows");
  }
  for (let index = 0; index < COMPATIBILITY_MATRIX_ROWS.length; index += 1) {
    const definition = COMPATIBILITY_MATRIX_ROWS[index];
    const row = report.rows[index];
    exactKeys(
      row,
      ["canonicalSurfaces", "expectedProtocol", "hyper", "id", "kit", "scenarios", "selection", "supportedPair"],
      `matrix row ${definition.id}`,
    );
    if (row.id !== definition.id
      || row.expectedProtocol !== definition.expectedProtocol
      || row.selection !== definition.selection
      || row.supportedPair !== true
      || canonicalStringify(row.kit) !== canonicalStringify(definition.kit)
      || canonicalStringify(row.hyper) !== canonicalStringify(definition.hyper)
      || canonicalStringify(row.canonicalSurfaces) !== canonicalStringify(definition.canonicalSurfaces)) {
      throw new Error(`Matrix row ${definition.id} overclaims or drifts from its frozen meaning`);
    }
    exactArray(row.scenarios.map(({ id }) => id), definition.scenarios, `matrix row ${definition.id} scenarios`);
    row.scenarios.forEach((scenario, scenarioIndex) => {
      validateScenario(scenario, definition.scenarios[scenarioIndex], `matrix row ${definition.id} scenario`);
    });
  }
  if (!Array.isArray(report.deliberatelyUnsupported)
    || report.deliberatelyUnsupported.length !== DELIBERATELY_UNSUPPORTED_CASES.length) {
    throw new Error("Matrix report must contain the complete negative corpus");
  }
  for (let index = 0; index < DELIBERATELY_UNSUPPORTED_CASES.length; index += 1) {
    const definition = DELIBERATELY_UNSUPPORTED_CASES[index];
    const negative = report.deliberatelyUnsupported[index];
    exactKeys(
      negative,
      ["assertions", "classification", "execution", "id", "passed", "rejectionObserved"],
      `negative case ${definition.id}`,
    );
    if (negative.classification !== "deliberately_unsupported" || negative.rejectionObserved !== true) {
      throw new Error(`Negative case ${definition.id} may prove rejection only`);
    }
    validateScenario(
      {
        assertions: negative.assertions,
        execution: negative.execution,
        id: negative.id,
        passed: negative.passed,
      },
      definition.id,
      `negative case ${definition.id}`,
    );
    const expectedAssertionIds = definition.category === "explicit_unsupported_request"
      ? ["process_completed", "exit_code", "error_code"]
      : ["process_completed", "exit_code", "reason_code", "canonical_action_absent"];
    exactArray(
      negative.assertions.map(({ id }) => id),
      expectedAssertionIds,
      `negative case ${definition.id} assertion IDs`,
    );
    const diagnostic = negative.assertions.find(({ id }) => (
      definition.category === "explicit_unsupported_request" ? id === "error_code" : id === "reason_code"
    ));
    const exitCode = negative.assertions.find(({ id }) => id === "exit_code");
    const actionAbsent = negative.assertions.find(({ id }) => id === "canonical_action_absent");
    if (exitCode?.expected !== 1
      || exitCode.observed !== 1
      || diagnostic?.expected !== definition.reasonCode
      || diagnostic.observed !== definition.reasonCode) {
      throw new Error(`Negative case ${definition.id} did not prove its exact rejection reason`);
    }
    if (definition.category !== "explicit_unsupported_request"
      && (actionAbsent?.expected !== true || actionAbsent.observed !== true)) {
      throw new Error(`Negative case ${definition.id} emitted a canonical action`);
    }
  }
  exactKeys(
    report.summary,
    ["deliberately_unsupported_passed", "positive_rows_passed", "tests_passed"],
    "matrix summary",
  );
  if (report.summary.deliberately_unsupported_passed !== DELIBERATELY_UNSUPPORTED_CASES.length
    || report.summary.positive_rows_passed !== COMPATIBILITY_MATRIX_ROWS.length
    || report.summary.tests_passed !== true) {
    throw new Error("Matrix summary does not describe a complete passing run");
  }
  const rendered = canonicalStringify(report);
  if (/visp-compatibility-lab-|timestamp|duration|pr[_ -]?readiness/iu.test(rendered)) {
    throw new Error("Matrix evidence contains unstable or authoritative report content");
  }
  return true;
}

function publicPack(pack) {
  return {
    byteSize: pack.byteSize,
    memberListBytes: pack.memberListBytes,
    memberListSha256: pack.memberListSha256,
    members: pack.members,
    package: pack.package,
    sha256: pack.sha256,
    tool: pack.tool,
  };
}

export function stableExecutionEvidence(result, unstablePaths = []) {
  if (!Array.isArray(unstablePaths)
    || unstablePaths.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new TypeError("unstablePaths must contain only non-empty strings");
  }
  const paths = [...new Set(unstablePaths)].sort((left, right) => right.length - left.length);
  const output = ({ text, truncated }) => {
    let stable = text;
    for (const unstablePath of paths) {
      stable = stable.replaceAll(unstablePath, "<VISP_MATRIX_OWNED_ROOT>");
    }
    return {
      bytes: Buffer.byteLength(stable, "utf8"),
      sha256: sha256Hex(stable),
      text: "",
      truncated,
    };
  };
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    spawnError: result.spawnError,
    stderr: output(result.stderr),
    stdout: output(result.stdout),
    timedOut: result.timedOut,
  };
}

function assertion(id, expected, observed) {
  return {
    expected,
    id,
    observed,
    passed: canonicalStringify(expected) === canonicalStringify(observed),
  };
}

function scenario(id, result, assertions, expectedExitCode = 0, unstablePaths = []) {
  const complete = assertion(
    "process_completed",
    true,
    result.spawnError === null && result.timedOut === false,
  );
  const all = [
    complete,
    assertion("exit_code", expectedExitCode, result.exitCode),
    ...assertions,
  ];
  return {
    assertions: all,
    execution: stableExecutionEvidence(result, unstablePaths),
    id,
    passed: all.every(({ passed }) => passed),
  };
}

function parseJsonOutput(result, label) {
  if (result.stdout.truncated) throw new Error(`${label} output was truncated`);
  try {
    return JSON.parse(result.stdout.text);
  } catch {
    throw new Error(`${label} did not emit JSON`);
  }
}

function parseFrame(result, begin, end, label) {
  const start = result.stdout.text.indexOf(begin);
  const finish = result.stdout.text.indexOf(end);
  if (start === -1 || finish === -1 || finish <= start
    || result.stdout.text.indexOf(begin, start + begin.length) !== -1) {
    throw new Error(`${label} did not emit one exact frame`);
  }
  const body = result.stdout.text.slice(start + begin.length, finish).trim();
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${label} frame body was malformed`);
  }
}

function parseLegacyAction(result) {
  return parseFrame(
    result,
    "BEGIN_VISP_WORKFLOW_ACTION_V2",
    "END_VISP_WORKFLOW_ACTION_V2",
    "Hyper legacy action",
  );
}

function parseHyperEnvelope(result) {
  return parseFrame(
    result,
    "BEGIN_VISP_HYPER_ACTION_V1",
    "END_VISP_HYPER_ACTION_V1",
    "Hyper canonical action",
  );
}

function parseAuthorityStopReason(result, label) {
  const begin = "BEGIN_VISP_KIT_AUTHORITY_RESULT";
  const end = "END_VISP_KIT_AUTHORITY_RESULT";
  const text = result.stdout.text;
  const start = text.indexOf(begin);
  const finish = text.indexOf(end);
  if (start === -1 || finish === -1 || finish <= start
    || text.indexOf(begin, start + begin.length) !== -1
    || text.indexOf(end, finish + end.length) !== -1) {
    throw new Error(`${label} did not emit one exact authority-stop frame`);
  }
  const matches = [...text.slice(start + begin.length, finish).matchAll(/^reason_code: ([a-z0-9_]+)$/gmu)];
  if (matches.length !== 1) {
    throw new Error(`${label} did not emit one exact authority-stop reason`);
  }
  return matches[0][1];
}

function canonicalActionAbsent(result) {
  return !/BEGIN_VISP_(?:HYPER_ACTION_V1|WORKFLOW_ACTION_V2)/u.test(result.stdout.text);
}

function installedExecutable(artifact, binName) {
  if (!artifact.evidence.install.bins.some(({ name }) => name === binName)) {
    throw new Error(`Installed binary is missing: ${binName}`);
  }
  return path.join(artifact.fixture, "node_modules", ".bin", binName);
}

function executionEnvironment(kitArtifact, hyperArtifact, extra = {}) {
  const directories = [
    path.join(kitArtifact.fixture, "node_modules", ".bin"),
    path.join(hyperArtifact.fixture, "node_modules", ".bin"),
    path.dirname(process.execPath),
  ];
  return {
    CI: "1",
    FORCE_COLOR: "0",
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "1",
    PATH: directories.join(path.delimiter),
    TZ: "UTC",
    ...extra,
  };
}

async function runExact(command, args, { cwd, env, stdin } = {}) {
  return runProcess(command, args, {
    cwd,
    env,
    ...(stdin === undefined ? {} : { stdin }),
    timeoutMs: 30_000,
  });
}

async function pathCommand(name) {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through the caller's executable search path.
    }
  }
  throw new Error(`Required scenario executable unavailable: ${name}`);
}

async function requireZero(result, label) {
  if (result.spawnError || result.timedOut || result.exitCode !== 0) {
    throw new Error(`${label} failed`);
  }
}

async function createScenarioProject(root, kitArtifact, hyperArtifact) {
  const project = path.join(root, "project");
  await mkdir(project);
  const environment = executionEnvironment(kitArtifact, hyperArtifact);
  const gitExecutable = await pathCommand("git");
  environment.PATH = `${environment.PATH}${path.delimiter}${path.dirname(gitExecutable)}`;
  const gitInit = await runExact(gitExecutable, ["init", "--quiet"], {
    cwd: project,
    env: environment,
  });
  await requireZero(gitInit, "Scenario Git initialization");
  const kit = installedExecutable(kitArtifact, "visp");
  const hyper = installedExecutable(hyperArtifact, "visp-hyper");
  await requireZero(
    await runExact(
      kit,
      ["init", project, "--agent", "none", "--strictness", "strict", "--json"],
      { cwd: project, env: environment },
    ),
    "Scenario Kit initialization",
  );
  await requireZero(
    await runExact(hyper, ["--project", project, "init"], { cwd: project, env: environment }),
    "Scenario Hyper initialization",
  );
  return { environment, hyper, kit, project };
}

function advertisedProtocols(contract) {
  return contract?.protocols?.workflowAction?.supported ?? null;
}

function actionProtocol(action) {
  return action?.protocolVersion ?? null;
}

function envelopeProtocol(envelope) {
  return envelope?.action?.source?.protocolVersion ?? null;
}

async function positiveRowEvidence(definition, root, kitArtifact, hyperArtifact) {
  const context = await createScenarioProject(root, kitArtifact, hyperArtifact);
  const recordScenario = (id, result, assertions, expectedExitCode = 0) => scenario(
    id,
    result,
    assertions,
    expectedExitCode,
    [root],
  );
  const scenarioOptions = {
    cwd: context.project,
    env: context.environment,
  };
  const runKit = (args) => runExact(context.kit, args, scenarioOptions);
  const runHyper = (args, options = {}) => runExact(
    context.hyper,
    ["--project", context.project, ...args],
    { ...scenarioOptions, ...options },
  );
  const selectorless = await runKit(["next", "--format", "json"]);
  const selectorlessAction = parseJsonOutput(selectorless, "Kit selectorless action");
  const contractResult = await runKit(["integration", "contract", "--json"]);
  const contract = parseJsonOutput(contractResult, "Kit integration contract");

  if (definition.id === "A") {
    const hyperNext = await runHyper(["next"]);
    const hyperAction = parseLegacyAction(hyperNext);
    return [
      recordScenario("kit_selectorless_v2", selectorless, [
        assertion("protocol", "2.0", actionProtocol(selectorlessAction)),
      ], 1),
      recordScenario("hyper_selectorless_v2", hyperNext, [
        assertion("protocol", "2.0", actionProtocol(hyperAction)),
      ]),
      recordScenario("no_protocol_advertisement", contractResult, [
        assertion("advertised_protocols", null, advertisedProtocols(contract)),
      ]),
    ];
  }

  if (definition.id === "B") {
    const explicitV3 = await runKit(["next", "--format", "json", "--protocol", "3.0"]);
    const hyperNext = await runHyper(["next"]);
    return [
      recordScenario("kit_selectorless_v2", selectorless, [
        assertion("protocol", "2.0", actionProtocol(selectorlessAction)),
      ], 1),
      recordScenario("kit_explicit_v3", explicitV3, [
        assertion("protocol", "3.0", actionProtocol(parseJsonOutput(explicitV3, "Kit v3 action"))),
      ], 1),
      recordScenario("hyper_selectorless_v2", hyperNext, [
        assertion("protocol", "2.0", actionProtocol(parseLegacyAction(hyperNext))),
      ]),
    ];
  }

  if (definition.id === "C") {
    const hyperNext = await runHyper(["next"]);
    const doctor = await runHyper(["doctor", "--json"]);
    const doctorSummary = parseJsonOutput(doctor, "Hyper doctor");
    const contractCheck = doctorSummary.checks?.find(({ id }) => id === "kit-contract");
    return [
      recordScenario("kit_advertises_v2_v3", contractResult, [
        assertion("advertised_protocols", ["2.0", "3.0"], advertisedProtocols(contract)),
      ]),
      recordScenario("hyper_selectorless_v2", hyperNext, [
        assertion("protocol", "2.0", actionProtocol(parseLegacyAction(hyperNext))),
      ]),
      recordScenario("advertisement_tolerated", doctor, [
        assertion("kit_contract_check", "pass", contractCheck?.status ?? null),
      ]),
    ];
  }

  if (definition.id === "D") {
    const doctor = await runHyper(["doctor", "--json"]);
    const summary = parseJsonOutput(doctor, "Hyper doctor");
    const protocolCheck = summary.checks?.find(({ id }) => id === "kit-workflow-action");
    const historicalNext = await runHyper(["next"]);
    return [
      recordScenario("doctor_negotiated_v3", doctor, [
        assertion("protocol_check", "pass", protocolCheck?.status ?? null),
        assertion("selected_protocol", true, /Selected protocol 3\.0/u.test(protocolCheck?.detail ?? "")),
        assertion("selection_mode", true, /via advertised/u.test(protocolCheck?.detail ?? "")),
      ]),
      recordScenario("historical_strict_next_v2", historicalNext, [
        assertion("protocol", "2.0", actionProtocol(parseLegacyAction(historicalNext))),
      ]),
    ];
  }

  const explicitV2 = await runKit(["next", "--format", "json", "--protocol", "2.0"]);
  const surfaceResults = new Map();
  surfaceResults.set("run", await runHyper(["run", "matrix compatibility proof"]));
  surfaceResults.set("next", await runHyper(["next"]));
  surfaceResults.set("resume", await runHyper(["resume", "--json"]));
  surfaceResults.set("checkpoint", await runHyper(["checkpoint", "--task", "T001"]));
  surfaceResults.set("guard", await runHyper(["guard", "--staged"]));
  const mcpInput = [
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "resources/read",
      params: { uri: "visp-hyper://current/canonical-action" },
    }),
    "",
  ].join("\n");
  surfaceResults.set("mcp", await runHyper(["serve", "--mcp"], { stdin: mcpInput }));
  const envelopes = new Map();
  envelopes.set("run", parseHyperEnvelope(surfaceResults.get("run")));
  envelopes.set("next", parseHyperEnvelope(surfaceResults.get("next")));
  envelopes.set("resume", parseJsonOutput(surfaceResults.get("resume"), "Hyper resume"));
  envelopes.set("checkpoint", parseHyperEnvelope(surfaceResults.get("checkpoint")));
  envelopes.set("guard", parseHyperEnvelope(surfaceResults.get("guard")));
  const mcpMessages = surfaceResults.get("mcp").stdout.text.trim().split("\n").map(JSON.parse);
  const resource = mcpMessages.find(({ id }) => id === 2)?.result?.contents?.[0]?.text;
  const mcpBody = JSON.parse(resource);
  envelopes.set("mcp", mcpBody.envelope);
  const canonicalHash = sha256Hex(canonicalStringify(envelopes.get("next")));
  const scenarios = [
    recordScenario("kit_selectorless_legacy_v2", selectorless, [
      assertion("protocol", "2.0", actionProtocol(selectorlessAction)),
    ], 1),
    recordScenario("kit_explicit_v2", explicitV2, [
      assertion("protocol", "2.0", actionProtocol(parseJsonOutput(explicitV2, "Kit explicit v2 action"))),
    ], 1),
    recordScenario("hyper_auto_v3", surfaceResults.get("next"), [
      assertion("protocol", "3.0", envelopeProtocol(envelopes.get("next"))),
      assertion("selection_mode", "advertised", envelopes.get("next")?.action?.source?.selectionMode ?? null),
    ], 1),
  ];
  for (const surface of POSITIVE_SURFACES) {
    const envelope = envelopes.get(surface);
    scenarios.push(recordScenario(`surface_${surface}`, surfaceResults.get(surface), [
      assertion("protocol", "3.0", envelopeProtocol(envelope)),
      assertion("canonical_envelope_sha256", canonicalHash, sha256Hex(canonicalStringify(envelope))),
    ], surface === "mcp" ? 0 : 1));
  }
  return scenarios;
}

const FAULT_WRAPPER = `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const result = spawnSync(process.env.VISP_MATRIX_REAL_KIT, args, { encoding: "utf8", env: process.env });
let stdout = result.stdout ?? "";
const fault = process.env.VISP_MATRIX_FAULT;
try {
  if (args[0] === "integration" && args[1] === "contract" && fault) {
    const value = JSON.parse(stdout);
    const workflow = value.protocols.workflowAction;
    if (fault === "future_protocol") {
      workflow.supported = ["4.0"];
      workflow.default = "4.0";
      workflow.schemaHashes = { "4.0": "sha256:" + "4".repeat(64) };
    } else if (fault === "malformed_advertisement") {
      workflow.supported = "2.0,3.0";
    } else if (fault === "schema_hash_mismatch") {
      workflow.schemaHashes["3.0"] = "sha256:" + "0".repeat(64);
    } else if (fault === "semantic_contradiction") {
      value.activeFeature = {
        id: "999",
        slug: "synthetic-mismatch",
        key: "999-synthetic-mismatch",
        path: ".visp/features/999-synthetic-mismatch"
      };
    }
    stdout = JSON.stringify(value) + "\\n";
  } else if (args[0] === "next" && fault === "malformed_action") {
    stdout = "{malformed-action\\n";
  } else if (args[0] === "next" && fault === "wrong_returned_protocol") {
    const value = JSON.parse(stdout);
    value.protocolVersion = "2.0";
    stdout = JSON.stringify(value) + "\\n";
  }
} catch {
  stdout = "{fault-wrapper-error\\n";
}
process.stdout.write(stdout);
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
`;

async function deliberatelyUnsupportedEvidence(root, kitArtifact, hyperArtifact) {
  const context = await createScenarioProject(root, kitArtifact, hyperArtifact);
  const recordScenario = (id, result, assertions, expectedExitCode = 0) => scenario(
    id,
    result,
    assertions,
    expectedExitCode,
    [root],
  );
  const wrapperDirectory = path.join(root, "fault-bin");
  await mkdir(wrapperDirectory);
  const wrapper = path.join(wrapperDirectory, "visp");
  await writeFile(wrapper, FAULT_WRAPPER, { mode: 0o755 });
  await chmod(wrapper, 0o755);
  const results = [];
  const faults = [
    "future_protocol",
    "malformed_advertisement",
    "schema_hash_mismatch",
    "malformed_action",
    "wrong_returned_protocol",
    "semantic_contradiction",
  ];
  for (const fault of faults) {
    const definition = DELIBERATELY_UNSUPPORTED_CASES.find(({ category }) => category === fault);
    if (!definition) throw new Error(`Missing frozen negative definition for ${fault}`);
    const environment = {
      ...context.environment,
      PATH: `${wrapperDirectory}${path.delimiter}${context.environment.PATH}`,
      VISP_MATRIX_FAULT: fault,
      VISP_MATRIX_REAL_KIT: context.kit,
    };
    const result = await runExact(
      context.hyper,
      ["--project", context.project, "next"],
      { cwd: context.project, env: environment },
    );
    const reasonCode = parseAuthorityStopReason(result, definition.id);
    const actionAbsent = canonicalActionAbsent(result);
    results.push({
      ...recordScenario(definition.id, result, [
        assertion("reason_code", definition.reasonCode, reasonCode),
        assertion("canonical_action_absent", true, actionAbsent),
      ], 1),
      classification: "deliberately_unsupported",
      rejectionObserved: result.exitCode === 1
        && reasonCode === definition.reasonCode
        && actionAbsent,
    });
  }
  const explicitDefinition = DELIBERATELY_UNSUPPORTED_CASES.at(-1);
  const explicit = await runExact(
    context.kit,
    ["next", "--format", "json", "--protocol", "4.0"],
    { cwd: context.project, env: context.environment },
  );
  const explicitBody = parseJsonOutput(explicit, explicitDefinition.id);
  const errorCode = explicitBody?.error?.code ?? null;
  results.push({
    ...recordScenario(explicitDefinition.id, explicit, [
      assertion("error_code", explicitDefinition.reasonCode, errorCode),
    ], 1),
    classification: "deliberately_unsupported",
    rejectionObserved: explicit.exitCode === 1
      && errorCode === explicitDefinition.reasonCode,
  });
  return results;
}

async function toolVersion(command, args = ["--version"]) {
  const result = await runExact(command, args);
  await requireZero(result, `${command} version`);
  return result.stdout.text.trim();
}

export async function runPackedCompatibilityMatrix(input) {
  plain(input, "matrix runner input");
  const required = [
    "hyperRepositoryRoot",
    "kitRepositoryRoot",
    "offlineCacheSource",
    "offlineStoreSource",
  ];
  for (const field of required) {
    if (typeof input[field] !== "string" || input[field].length === 0) {
      throw new TypeError(`${field} must be a non-empty path`);
    }
  }
  if (input.keepOwnedRoot !== undefined && typeof input.keepOwnedRoot !== "boolean") {
    throw new TypeError("keepOwnedRoot must be a boolean");
  }
  const selectedDefinitions = selectCompatibilityMatrixRows(input.row ?? null);
  const owned = await createOwnedRoot();
  try {
    const packageDefinitions = new Map();
    for (const row of selectedDefinitions) {
      packageDefinitions.set(row.kit.commit, {
        repositoryRoot: input.kitRepositoryRoot,
        source: row.kit,
      });
      packageDefinitions.set(row.hyper.commit, {
        repositoryRoot: input.hyperRepositoryRoot,
        source: row.hyper,
      });
    }
    const artifacts = new Map();
    const packages = {};
    for (const [commit, definition] of packageDefinitions) {
      const packageRoot = await createOwnedRoot({ baseDirectory: owned.root });
      const packed = await packPackageTwice({
        repositoryRoot: definition.repositoryRoot,
        commit,
        ownedRoot: packageRoot.root,
        offlineStoreSource: input.offlineStoreSource,
      });
      const materializedLock = path.join(packageRoot.root, "runtime-package-lock.json");
      const runtimeLock = await materializeRuntimeInstallLock({
        outputPath: materializedLock,
        package: packed.package,
        tarballPath: packed.tarballPath,
      });
      const fixture = path.join(packageRoot.root, "install");
      const install = await installLocalTarball({
        tarballPath: packed.tarballPath,
        fixtureRoot: fixture,
        offlineCacheSource: input.offlineCacheSource,
        offlineInstallLockSource: materializedLock,
      });
      const evidence = {
        install,
        pack: {
          byteEquality: true,
          first: publicPack(packed.first),
          second: publicPack(packed.second),
        },
        preparations: [packed.preparations.first, packed.preparations.second],
        runtimeLock,
        source: { commit: packed.commit, tree: packed.tree },
      };
      artifacts.set(commit, { evidence, fixture });
      packages[commit] = evidence;
    }
    const rowEvidence = [];
    for (const definition of selectedDefinitions) {
      const rowRoot = await createOwnedRoot({ baseDirectory: owned.root });
      rowEvidence.push({
        id: definition.id,
        scenarios: await positiveRowEvidence(
          definition,
          rowRoot.root,
          artifacts.get(definition.kit.commit),
          artifacts.get(definition.hyper.commit),
        ),
      });
    }
    if (input.row !== undefined) {
      const debug = JSON.parse(canonicalStringify({
        packages,
        rows: selectedDefinitions.map((definition) => ({
          canonicalSurfaces: definition.canonicalSurfaces,
          expectedProtocol: definition.expectedProtocol,
          hyper: definition.hyper,
          id: definition.id,
          kit: definition.kit,
          scenarios: rowEvidence.find(({ id }) => id === definition.id).scenarios,
          selection: definition.selection,
        })),
        schemaVersion: "visp.compatibility-matrix.debug.v1",
        selection: { rows: selectedDefinitions.map(({ id }) => id) },
      }));
      if (input.keepOwnedRoot === true) {
        Object.defineProperty(debug, "retainedRoot", { enumerable: false, value: owned.root });
      }
      return debug;
    }
    const negativeRoot = await createOwnedRoot({ baseDirectory: owned.root });
    const final = COMPATIBILITY_MATRIX_ROWS.at(-1);
    const deliberatelyUnsupported = await deliberatelyUnsupportedEvidence(
      negativeRoot.root,
      artifacts.get(final.kit.commit),
      artifacts.get(final.hyper.commit),
    );
    const report = createCompatibilityMatrixReport({
      deliberatelyUnsupported,
      environment: {
        architecture: process.arch,
        git: await toolVersion("git"),
        node: process.version,
        npm: await toolVersion("npm"),
        operatingSystem: process.platform,
        pnpm: await toolVersion("pnpm"),
      },
      packages,
      rows: rowEvidence,
    });
    if (input.keepOwnedRoot === true) {
      Object.defineProperty(report, "retainedRoot", { enumerable: false, value: owned.root });
    }
    return report;
  } catch (error) {
    if (input.keepOwnedRoot === true) {
      Object.defineProperty(error, "retainedRoot", { enumerable: false, value: owned.root });
    }
    throw error;
  } finally {
    await cleanupOwnedRoot({ root: owned.root, keep: input.keepOwnedRoot === true });
  }
}
