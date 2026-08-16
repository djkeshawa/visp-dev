/**
 * The matrix report and its verifier.
 *
 * Every assertion in this document carries both its expected and its observed
 * value, and the verifier RECOMPUTES `passed` from those two rather than
 * trusting the flag. That is the whole design: a report cannot record a pass it
 * did not earn, and flipping `passed` after the fact is caught even if the
 * report is rehashed.
 *
 * A row also cannot overclaim. `supportedPair` is written by the constructor
 * from the frozen definition, never copied from the evidence, and
 * `canonicalSurfaces` must equal the frozen value — so a row cannot silently
 * start claiming six-surface agreement it never measured.
 */
import { canonicalStringify, sha256Hex } from "../../platform/canonical-json.mjs";
import { COMMIT, HASH, exactArray, exactKeys, plainObject } from "../../platform/shape.mjs";
import {
  COMPATIBILITY_MATRIX_ROWS,
  COMPATIBILITY_MATRIX_SHA256,
  DELIBERATELY_UNSUPPORTED_CASES,
} from "./rows.mjs";

const SCHEMA_VERSION = "visp.compatibility-matrix.evidence.v1";
/**
 * The matrix's own unstable-content guard. It differs from the suites' on
 * purpose: `pr_readiness` is authoritative language the matrix must never
 * emit, and `generatedAt`/`checkedAt` never appear in this shape.
 */
const UNSTABLE_CONTENT = /visp-compatibility-lab-|timestamp|duration|pr[_ -]?readiness/iu;

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
  // The two assertions every scenario must carry, cross-checked against the
  // execution record they claim to describe.
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
  // Two independent preparations that must agree: a dependency graph that
  // resolves differently on a second run is not a pinned graph.
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
  plainObject(input, "matrix input");
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
    schemaVersion: SCHEMA_VERSION,
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

function verifyNegativeCase(negative, definition) {
  const label = `negative case ${definition.id}`;
  exactKeys(
    negative,
    ["assertions", "classification", "execution", "id", "passed", "rejectionObserved"],
    label,
  );
  if (negative.classification !== "deliberately_unsupported" || negative.rejectionObserved !== true) {
    throw new Error(`${label} may prove rejection only`);
  }
  validateScenario(
    {
      assertions: negative.assertions,
      execution: negative.execution,
      id: negative.id,
      passed: negative.passed,
    },
    definition.id,
    label,
  );
  const explicit = definition.category === "explicit_unsupported_request";
  exactArray(
    negative.assertions.map(({ id }) => id),
    explicit
      ? ["process_completed", "exit_code", "error_code"]
      : ["process_completed", "exit_code", "reason_code", "canonical_action_absent"],
    `${label} assertion IDs`,
  );
  const diagnostic = negative.assertions.find(
    ({ id }) => id === (explicit ? "error_code" : "reason_code"),
  );
  const exitCode = negative.assertions.find(({ id }) => id === "exit_code");
  const actionAbsent = negative.assertions.find(({ id }) => id === "canonical_action_absent");
  if (exitCode?.expected !== 1
    || exitCode.observed !== 1
    || diagnostic?.expected !== definition.reasonCode
    || diagnostic.observed !== definition.reasonCode) {
    throw new Error(`${label} did not prove its exact rejection reason`);
  }
  if (!explicit && (actionAbsent?.expected !== true || actionAbsent.observed !== true)) {
    throw new Error(`${label} emitted a canonical action`);
  }
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
  if (report.schemaVersion !== SCHEMA_VERSION) throw new Error("Unsupported matrix evidence schema");
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
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("Matrix environment is incomplete");
    }
  }

  const packageExpectations = new Map();
  for (const row of COMPATIBILITY_MATRIX_ROWS) {
    packageExpectations.set(row.kit.commit, { kind: "kit", source: row.kit });
    packageExpectations.set(row.hyper.commit, { kind: "hyper", source: row.hyper });
  }
  exactArray(
    Object.keys(report.packages).sort(),
    [...packageExpectations.keys()].sort(),
    "matrix packages",
  );
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
  COMPATIBILITY_MATRIX_ROWS.forEach((definition, index) => {
    const row = report.rows[index];
    exactKeys(
      row,
      [
        "canonicalSurfaces",
        "expectedProtocol",
        "hyper",
        "id",
        "kit",
        "scenarios",
        "selection",
        "supportedPair",
      ],
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
    exactArray(
      row.scenarios.map(({ id }) => id),
      definition.scenarios,
      `matrix row ${definition.id} scenarios`,
    );
    row.scenarios.forEach((scenario, scenarioIndex) => {
      validateScenario(scenario, definition.scenarios[scenarioIndex], `matrix row ${definition.id} scenario`);
    });
  });

  if (!Array.isArray(report.deliberatelyUnsupported)
    || report.deliberatelyUnsupported.length !== DELIBERATELY_UNSUPPORTED_CASES.length) {
    throw new Error("Matrix report must contain the complete negative corpus");
  }
  DELIBERATELY_UNSUPPORTED_CASES.forEach((definition, index) => {
    verifyNegativeCase(report.deliberatelyUnsupported[index], definition);
  });

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
  if (UNSTABLE_CONTENT.test(canonicalStringify(report))) {
    throw new Error("Matrix evidence contains unstable or authoritative report content");
  }
  return true;
}
