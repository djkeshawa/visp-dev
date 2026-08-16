/**
 * Running one matrix row, and running the negative corpus, against installed
 * binaries.
 *
 * THE EXECUTION HELPERS HERE ARE THE MATRIX'S OWN, NOT THE SUITES'. Every pinned
 * row was produced under a 30-second timeout, an index-based frame parser
 * (`parseExactFrame`), and a `requireZero` that throws without attaching the
 * observation. The suites' same-named helpers use 120 seconds, a regex frame
 * parser, and an observation-carrying failure, and they accept different
 * documents — a frame whose body shares a line with its delimiter passes one
 * and fails the other. Repointing this file at the suites' versions would change
 * what these rows accept with no test saying so. See
 * `docs/refactor/slice-a-renames.md`.
 */
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalStringify, sha256Hex } from "../../platform/canonical-json.mjs";
import {
  canonicalActionAbsent,
  createScenarioProject,
  parseAuthorityStopReason,
  parseHyperEnvelope,
  parseJsonOutput,
  parseLegacyAction,
} from "../../toolchain/index.mjs";
import { scenarioRunExact } from "../../toolchain/project-fixture.mjs";
import { DELIBERATELY_UNSUPPORTED_CASES, POSITIVE_SURFACES } from "./rows.mjs";

/**
 * Execution evidence with the owned root replaced by a fixed sentinel.
 *
 * The raw text is discarded and only its digest kept: two runs in different
 * temporary directories must produce the same evidence, and a report carrying
 * the literal path could never be compared against another run's.
 */
export function stableExecutionEvidence(result, unstablePaths = []) {
  if (!Array.isArray(unstablePaths)
    || unstablePaths.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new TypeError("unstablePaths must contain only non-empty strings");
  }
  // Longest first, so a nested owned root is replaced before its parent turns
  // the remainder into an unmatchable suffix.
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

export function assertion(id, expected, observed) {
  return {
    expected,
    id,
    observed,
    passed: canonicalStringify(expected) === canonicalStringify(observed),
  };
}

export function scenario(id, result, assertions, expectedExitCode = 0, unstablePaths = []) {
  const all = [
    assertion("process_completed", true, result.spawnError === null && result.timedOut === false),
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

const advertisedProtocols = (contract) => contract?.protocols?.workflowAction?.supported ?? null;
const actionProtocol = (action) => action?.protocolVersion ?? null;
const envelopeProtocol = (envelope) => envelope?.action?.source?.protocolVersion ?? null;

export async function positiveRowEvidence(definition, root, kitArtifact, hyperArtifact) {
  const context = await createScenarioProject(root, kitArtifact, hyperArtifact);
  const recordScenario = (id, result, assertions, expectedExitCode = 0) => scenario(
    id,
    result,
    assertions,
    expectedExitCode,
    [root],
  );
  const scenarioOptions = { cwd: context.project, env: context.environment };
  const runKit = (args) => scenarioRunExact(context.kit, args, scenarioOptions);
  const runHyper = (args, options = {}) => scenarioRunExact(
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
    return [
      recordScenario("kit_selectorless_v2", selectorless, [
        assertion("protocol", "2.0", actionProtocol(selectorlessAction)),
      ], 1),
      recordScenario("hyper_selectorless_v2", hyperNext, [
        assertion("protocol", "2.0", actionProtocol(parseLegacyAction(hyperNext))),
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
  envelopes.set("mcp", JSON.parse(resource).envelope);

  // One hash for the whole envelope, compared across all six surfaces. Field-by
  // -field checks would miss a surface that added something.
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

/**
 * A shim that stands in for Kit on PATH and corrupts exactly one field.
 *
 * Faults are injected at the boundary Hyper reads rather than by editing Kit,
 * so the negative corpus measures Hyper's own refusal rather than a Kit build
 * nobody ships.
 */
export const FAULT_WRAPPER = `#!/usr/bin/env node
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

const WRAPPER_FAULTS = [
  "future_protocol",
  "malformed_advertisement",
  "schema_hash_mismatch",
  "malformed_action",
  "wrong_returned_protocol",
  "semantic_contradiction",
];

export async function deliberatelyUnsupportedEvidence(root, kitArtifact, hyperArtifact) {
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
  for (const fault of WRAPPER_FAULTS) {
    const definition = DELIBERATELY_UNSUPPORTED_CASES.find(({ category }) => category === fault);
    if (!definition) throw new Error(`Missing frozen negative definition for ${fault}`);
    const environment = {
      ...context.environment,
      PATH: `${wrapperDirectory}${path.delimiter}${context.environment.PATH}`,
      VISP_MATRIX_FAULT: fault,
      VISP_MATRIX_REAL_KIT: context.kit,
    };
    const result = await scenarioRunExact(
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

  // The one case Kit itself refuses, so there is no wrapper and no reason frame
  // — the refusal arrives as a structured error code instead.
  const explicitDefinition = DELIBERATELY_UNSUPPORTED_CASES.at(-1);
  const explicit = await scenarioRunExact(
    context.kit,
    ["next", "--format", "json", "--protocol", "4.0"],
    { cwd: context.project, env: context.environment },
  );
  const errorCode = parseJsonOutput(explicit, explicitDefinition.id)?.error?.code ?? null;
  results.push({
    ...recordScenario(explicitDefinition.id, explicit, [
      assertion("error_code", explicitDefinition.reasonCode, errorCode),
    ], 1),
    classification: "deliberately_unsupported",
    rejectionObserved: explicit.exitCode === 1 && errorCode === explicitDefinition.reasonCode,
  });
  return results;
}
