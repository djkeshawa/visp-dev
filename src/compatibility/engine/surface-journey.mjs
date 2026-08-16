/**
 * Driving one project through Kit and reading it back on all six Hyper surfaces.
 *
 * This is the code R5 exists for. It used to live inside the
 * mixed-generation suite, and the additive-fixes suite imported eight symbols
 * out of it, which made a suite a library for another suite: touching the older
 * pin's helper silently changed what the newer pin proved. Nothing here is
 * specific to a pinned pair — every value a suite pins is passed in.
 *
 * The six surfaces are the whole point. `run`, `next`, `resume`, `checkpoint`,
 * `guard` and `mcp` reach the canonical action by four different transports, and
 * a projection that agreed on five of them and dropped a field on the sixth is
 * exactly the defect these suites were built to catch.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createRealProject,
  parseFrame,
  parseJson,
  requireCompleted,
  runExact,
} from "../../toolchain/index.mjs";
import { PREFIXED_HASH, exactKeys } from "../../platform/shape.mjs";

const ACTION_FRAME = ["BEGIN_VISP_HYPER_ACTION_V1", "END_VISP_HYPER_ACTION_V1"];
const VERDICTS = ["ready", "blocked", "inconclusive"];

const MCP_REQUEST = [
  JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "resources/read",
    params: { uri: "visp-hyper://current/canonical-action" },
  }),
  "",
].join("\n");

/**
 * The canonical action inside an MCP `resources/read` response.
 *
 * `requireAvailability` is off for the oldest pinned pair only: its Hyper
 * predates the `availability` field, so demanding it would fail that suite for
 * a reason that has nothing to do with what it proves. Every later pair emits
 * the field and must, because a resource that reports unavailable and is read
 * anyway yields an action nothing produced.
 */
export function mcpAction(result, label, { requireAvailability = true } = {}) {
  const messages = result.stdout.text.trim().split("\n").map((line) => JSON.parse(line));
  const text = messages.find(({ id }) => id === 2)?.result?.contents?.[0]?.text;
  if (typeof text !== "string") throw new Error(`${label} omitted the canonical action resource`);
  const resource = JSON.parse(text);
  if (requireAvailability && resource.availability !== "available") {
    throw new Error(`${label} canonical action resource was unavailable`);
  }
  return resource.envelope.action;
}

/**
 * Every configured surface's canonical action, keyed by surface id.
 *
 * `goal` is the free text `hyper run` is given, and `beforeGuard` runs between
 * `checkpoint` and `guard`. Both exist because a suite's pins were taken under
 * its exact wording and its exact staging point — the oldest suite stages the
 * whole tree just before `guard`, and moving that earlier would change what the
 * four preceding surfaces saw.
 */
export async function collectSurfaceActions({
  context,
  hyper,
  label,
  taskId,
  goal = `${label} installed-binary journey`,
  beforeGuard = null,
  requireAvailability = true,
}) {
  const rawHyper = async (args, surface, stdin) => requireCompleted(
    await runExact(
      hyper.executable,
      ["--project", context.project, ...args],
      {
        cwd: context.project,
        env: context.env,
        ...(stdin === undefined ? {} : { stdin }),
      },
    ),
    `${label} ${surface}`,
  );
  const results = new Map();
  results.set("run", await rawHyper(["run", goal], "run"));
  results.set("next", await rawHyper(["next"], "next"));
  results.set("resume", await rawHyper(["resume", "--json"], "resume"));
  results.set("checkpoint", await rawHyper(["checkpoint", "--task", taskId], "checkpoint"));
  if (beforeGuard !== null) await beforeGuard();
  results.set("guard", await rawHyper(["guard", "--staged"], "guard"));
  results.set("mcp", await rawHyper(["serve", "--mcp"], "mcp", MCP_REQUEST));

  const framed = (surface) => parseFrame(
    results.get(surface),
    ...ACTION_FRAME,
    `${label} ${surface}`,
  ).action;
  return new Map([
    ["run", framed("run")],
    ["next", framed("next")],
    ["resume", parseJson(results.get("resume"), `${label} resume`).action],
    ["checkpoint", framed("checkpoint")],
    ["guard", framed("guard")],
    ["mcp", mcpAction(results.get("mcp"), `${label} mcp`, { requireAvailability })],
  ]);
}

/**
 * The WorkflowAction 3.2 facts a suite compares, projected out of one action.
 *
 * The expected hash is the CALLER's `schemaHash` so no suite reads another
 * suite's frozen definition to decide what it accepts.
 */
export function projectActionView(action, schemaHash) {
  const protocolVersion = action?.protocolVersion ?? action?.source?.protocolVersion;
  const actionId = typeof action?.actionId === "string"
    ? action.actionId
    : action?.actionId?.state === "available"
      ? action.actionId.value
      : null;
  const localSchemaHash = action?.source?.localSchemaHash ?? schemaHash;
  const assuranceSummary = action?.assuranceSummary;
  if (protocolVersion !== "3.2"
    || localSchemaHash !== schemaHash
    || !PREFIXED_HASH.test(actionId ?? "")
    || assuranceSummary?.state !== "available"
    || typeof action?.nextCommand !== "string"
    || !VERDICTS.includes(action?.verdict)) {
    throw new Error("Installed WorkflowAction 3.2 omitted authoritative assurance facts");
  }
  return {
    actionId,
    actionVerdict: action.verdict,
    assuranceSummary: structuredClone(assuranceSummary),
    assuranceVerdict: assuranceSummary.verdict,
    caseHash: assuranceSummary.caseHash,
    mandatoryHotspots: structuredClone(assuranceSummary.mandatoryHotspots),
    nextCommand: action.nextCommand,
    protocolVersion,
    reviewDecision: structuredClone(assuranceSummary.reviewDecision),
    schemaHash: localSchemaHash,
  };
}

/** The negotiation facts a mixed-generation row compares, projected out of one action. */
export function compatibilityActionView(action, definition) {
  const protocolVersion = action?.source?.protocolVersion;
  const actionId = action?.actionId?.state === "available" ? action.actionId.value : null;
  if (protocolVersion !== definition.expectedProtocol
    || action?.source?.selectionMode !== "advertised"
    || action?.source?.localSchemaHash !== definition.expectedSchemaHash
    || !PREFIXED_HASH.test(actionId ?? "")
    || typeof action?.nextCommand !== "string"
    || !VERDICTS.includes(action?.verdict)) {
    throw new Error(`Installed compatibility row ${definition.id} drifted`);
  }
  return {
    actionId,
    actionVerdict: action.verdict,
    nextCommand: action.nextCommand,
    protocolVersion,
    schemaHash: action.source.localSchemaHash,
    selectionMode: action.source.selectionMode,
  };
}

/** Kit's own hotspot facts, shape-checked without judging their content. */
export function validateHotspots(hotspots, label) {
  if (!Array.isArray(hotspots)) throw new Error(`${label} must be an array`);
  for (const hotspot of hotspots) {
    exactKeys(hotspot, ["category", "id", "path", "reason", "severity"], label);
    if (typeof hotspot.id !== "string"
      || typeof hotspot.category !== "string"
      || typeof hotspot.severity !== "string"
      || (hotspot.path !== null && typeof hotspot.path !== "string")
      || typeof hotspot.reason !== "string"
      || hotspot.reason.length === 0) {
      throw new Error(`${label} contains malformed Kit hotspot facts`);
    }
  }
  return true;
}

/**
 * The exact sequence Kit requires before a canonical action means anything:
 * oracle plan, optional human approval, lock, baseline, implement gate, a real
 * candidate edit, candidate evidence, assurance generation, and the review
 * decision the scenario calls for.
 *
 * `flow: "stale"` deliberately edits the candidate again AFTER acceptance, so
 * the recorded decision no longer describes the tree — that is the state the
 * scenario exists to observe.
 */
export async function prepareEvidence({ context, definition, label, reviewer }) {
  const plan = ["oracle", "plan", context.project, "--task", definition.taskId, "--json"];
  if (definition.testIndependence === "pre_approved") {
    plan.push("--pre-approved-test", "tests/profile.test.mjs");
  }
  await context.runKit(plan, `${label} oracle plan`);
  if (definition.humanApproval) {
    await context.runKit(
      [
        "oracle",
        "approve",
        context.project,
        "--task",
        definition.taskId,
        "--reviewer",
        reviewer,
        "--reason",
        "The critical installed-binary oracle was reviewed for compatibility evidence.",
        "--json",
      ],
      `${label} oracle approval`,
    );
  }
  await context.runKit(
    ["oracle", "lock", context.project, "--task", definition.taskId, "--json"],
    `${label} oracle lock`,
  );
  await context.runKit(
    ["verify", context.project, "--baseline", "--task", definition.taskId, "--json"],
    `${label} baseline`,
  );
  await context.runKit(
    ["gate", "implement", context.project, "--task", definition.taskId, "--json"],
    `${label} implement authorization`,
  );

  const relativeCandidate = definition.profile === "routine" ? "docs/profile.md" : "src/profile.mjs";
  const candidatePath = path.join(context.project, relativeCandidate);
  const original = await readFile(candidatePath, "utf8");
  await writeFile(candidatePath, `${original.trimEnd()}\n// candidate ${definition.id}\n`);
  await context.runGit(["add", relativeCandidate], `${label} candidate staging`);
  if (definition.flow !== "inconclusive") {
    await context.runKit(
      ["verify", context.project, "--candidate", "--task", definition.taskId, "--json"],
      `${label} candidate`,
    );
  }
  await context.runKit(
    ["assurance", "generate", context.project, "--task", definition.taskId, "--json"],
    `${label} assurance generation`,
  );

  const assuranceRelative = path.posix.join(
    context.featureRelativePath.replaceAll("\\", "/"),
    "assurance",
    definition.taskId,
    "assurance-case.json",
  );
  const assuranceCase = JSON.parse(
    await readFile(path.join(context.project, assuranceRelative), "utf8"),
  );
  const mandatory = assuranceCase.hotspots
    .filter(({ mandatory: required }) => required)
    .map(({ id }) => id);

  if (definition.flow === "accepted" || definition.flow === "stale") {
    const args = [
      "assurance",
      "accept",
      context.project,
      "--task",
      definition.taskId,
      "--reviewer",
      reviewer,
      "--reason",
      "The installed-binary assurance case and mandatory hotspots were reviewed.",
      "--json",
    ];
    for (const hotspot of mandatory) args.push("--reviewed-hotspot", hotspot);
    await context.runKit(args, `${label} acceptance`);
  } else if (definition.flow === "rejected") {
    await context.runKit(
      [
        "assurance",
        "reject",
        context.project,
        "--task",
        definition.taskId,
        "--reviewer",
        reviewer,
        "--reason",
        "The installed-binary assurance evidence remains insufficient for acceptance.",
        "--json",
      ],
      `${label} rejection`,
    );
  }
  if (definition.flow === "stale") {
    await writeFile(candidatePath, `${await readFile(candidatePath, "utf8")}// material drift\n`);
  }
}

/**
 * One golden scenario: a real project, real evidence, Kit's own action, and the
 * same action read back on all six surfaces.
 *
 * The scenario, surface list, schema hash, label and reviewer are all
 * parameters. They were constants inside a suite, which is how the next suite
 * ended up importing this function out of an older suite's pin (R5).
 */
export async function runAssuranceScenario({
  definition,
  hyper,
  kit,
  label,
  reviewer,
  root,
  schemaHash,
  surfaces,
}) {
  const context = await createRealProject({ definition, hyper, kit, root });
  await prepareEvidence({ context, definition, label, reviewer });
  const kitResult = requireCompleted(
    await runExact(
      kit.executable,
      ["next", context.project, "--format", "json", "--protocol", "3.2"],
      { cwd: context.project, env: context.env },
    ),
    `${label} Kit action`,
  );
  const kitView = projectActionView(
    parseJson(kitResult, `${label} Kit action`),
    schemaHash,
  );
  const actions = await collectSurfaceActions({
    context,
    hyper,
    label,
    taskId: definition.taskId,
  });
  return {
    flow: definition.flow,
    id: definition.id,
    kit: kitView,
    profile: definition.profile,
    surfaces: surfaces.map((id) => ({
      id,
      view: projectActionView(actions.get(id), schemaHash),
    })),
  };
}

/**
 * One compatibility row: a healthy project, one staged edit, and the negotiated
 * action as each surface reports it.
 *
 * No assurance evidence is prepared. The question is only whether this exact
 * pairing of generations agrees on a protocol, which is answerable without one.
 */
export async function runPairCompatibilityJourney({
  definition,
  hyper,
  kit,
  label,
  root,
  scenario,
  surfaces,
}) {
  const context = await createRealProject({ definition: scenario, hyper, kit, root });
  const relativeCandidate = "docs/profile.md";
  await writeFile(
    path.join(context.project, relativeCandidate),
    `${await readFile(path.join(context.project, relativeCandidate), "utf8")}// compatibility\n`,
  );
  await context.runGit(["add", relativeCandidate], `${label} ${definition.id} staging`);
  const actions = await collectSurfaceActions({
    context,
    hyper,
    label: `${label} ${definition.id}`,
    taskId: scenario.taskId,
  });
  return {
    id: definition.id,
    surfaces: surfaces.map((id) => ({
      id,
      view: compatibilityActionView(actions.get(id), definition),
    })),
  };
}
