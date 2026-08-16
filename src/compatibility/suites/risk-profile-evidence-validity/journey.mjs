/**
 * One risk profile, driven end to end against the packed pair.
 *
 * The measurement is deliberately narrow: authorise a scoped task, produce
 * genuine candidate evidence, then read the same canonical action back on all
 * six surfaces and project each one down to the fields that matter. Whether the
 * six agree is the finding.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createRealProject,
  parseJson,
  readArtifactBinding,
  requireCompleted,
  runExact,
} from "../../../toolchain/index.mjs";
import { PREFIXED_HASH } from "../../../platform/shape.mjs";
import { collectSurfaceActions } from "../../engine/surface-journey.mjs";
import {
  PREFIXED_SCHEMA_HASH,
  PROTOCOL_VERSION,
  RISK_PROFILE_EVIDENCE_VALIDITY as SUITE,
} from "./definition.mjs";

const DEFINITION = SUITE.definition;
const REVIEWER = "human-compatibility-reviewer";

/**
 * The WorkflowAction 3.1 facts this suite compares, projected out of one action.
 *
 * Kit and Hyper render the same envelope differently — Kit inlines
 * `protocolVersion` and `actionId`, Hyper wraps them in availability records —
 * so both spellings are read and reduced to one comparable view. That reduction
 * is the whole test: if a surface cannot produce the view, it lost a fact.
 */
export function normalizeCandidateView(action, definition, label) {
  const protocolVersion = action?.protocolVersion ?? action?.source?.protocolVersion;
  const canonicalVersion = action?.canonicalVersion
    ?? (action?.sourceCanonicalVersion?.state === "available"
      ? action.sourceCanonicalVersion.value
      : null);
  const actionId = typeof action?.actionId === "string"
    ? action.actionId
    : action?.actionId?.state === "available"
      ? action.actionId.value
      : null;
  const schemaHash = action?.source?.localSchemaHash ?? PREFIXED_SCHEMA_HASH;
  if (protocolVersion !== PROTOCOL_VERSION
    || canonicalVersion !== "1.1"
    || !PREFIXED_HASH.test(actionId ?? "")
    || schemaHash !== PREFIXED_SCHEMA_HASH
    || action?.assurance?.profile?.state !== "available"
    || action.assurance.profile.value !== definition.profile
    || action?.evidence?.state !== "available") {
    throw new Error(`${label} did not preserve WorkflowAction 3.1 assurance`);
  }
  const evidence = action.evidence.value;
  if (evidence.source !== "candidate"
    || evidence.outcome !== "passed"
    || evidence.freshness !== "fresh"
    || !Array.isArray(evidence.providers)
    || evidence.providers.length === 0) {
    throw new Error(`${label} did not preserve fresh passed candidate evidence`);
  }
  const providers = evidence.providers.map((provider) => ({
    results: provider.results.map((result) => ({
      freshness: result.freshness?.status ?? null,
      independence: result.independence,
      status: result.outcome?.status ?? null,
    })),
    status: provider.status,
  }));
  const independence = providers.flatMap(({ results }) => results)
    .map((result) => result.independence);
  if (!independence.includes(definition.testIndependence)) {
    throw new Error(`${label} lost ${definition.testIndependence} test evidence`);
  }
  return {
    actionId,
    evidence: {
      freshness: evidence.freshness,
      outcome: evidence.outcome,
      providers,
      source: evidence.source,
    },
    profile: action.assurance.profile.value,
    protocolVersion,
    schemaHash,
  };
}

async function authorizeAndProveCandidate(context, definition, label) {
  const planArgs = ["oracle", "plan", context.project, "--task", definition.taskId, "--json"];
  if (definition.testIndependence === "pre_approved") {
    planArgs.push("--pre-approved-test", "tests/profile.test.mjs");
  }
  await context.runKit(planArgs, `${label} oracle plan`);
  if (definition.humanApproval) {
    await context.runKit(
      [
        "oracle",
        "approve",
        context.project,
        "--task",
        definition.taskId,
        "--reviewer",
        REVIEWER,
        "--reason",
        "The critical compatibility oracle and its pre-approved test were reviewed.",
        "--json",
      ],
      `${label} critical oracle approval`,
    );
  }
  await context.runKit(
    ["oracle", "lock", context.project, "--task", definition.taskId, "--json"],
    `${label} initial oracle lock`,
  );
  await context.runKit(
    ["verify", context.project, "--baseline", "--task", definition.taskId, "--json"],
    `${label} baseline`,
  );
  await context.runKit(
    ["gate", "implement", context.project, "--task", definition.taskId, "--json"],
    `${label} implement authorization`,
  );
  const candidatePath = definition.profile === "routine"
    ? path.join(context.project, "docs", "profile.md")
    : path.join(context.project, "src", "profile.mjs");
  const original = await readFile(candidatePath, "utf8");
  await writeFile(candidatePath, `${original.trimEnd()}\n// candidate ${definition.profile}\n`);
  await context.runKit(
    ["verify", context.project, "--candidate", "--task", definition.taskId, "--json"],
    `${label} candidate`,
  );
}

async function readAssuranceArtifacts(context, definition) {
  const assuranceDir = path.posix.join(
    context.featureRelativePath.replaceAll("\\", "/"),
    "assurance",
    definition.taskId,
  );
  const binding = (name) => readArtifactBinding(
    context.project,
    path.posix.join(assuranceDir, name),
  );
  const artifacts = {
    baseline: await binding("baseline-evidence.json"),
    candidate: await binding("candidate-evidence.json"),
    lock: await binding("oracle-lock.json"),
    plan: await binding("oracle-plan.json"),
  };
  if (definition.humanApproval) {
    const approval = JSON.parse(await readFile(
      path.join(context.project, assuranceDir, "oracle-approval.json"),
      "utf8",
    ));
    if (approval.status !== "approved") {
      throw new Error(`${SUITE.id} critical approval is not active`);
    }
  }
  return artifacts;
}

export async function runProfileScenario({ definition, hyper, kit, root }) {
  const label = `${SUITE.id} ${definition.profile}`;
  const context = await createRealProject({ definition, hyper, kit, root });
  await authorizeAndProveCandidate(context, definition, label);

  const kitResult = requireCompleted(
    await runExact(
      kit.executable,
      ["next", context.project, "--format", "json", "--protocol", PROTOCOL_VERSION],
      { cwd: context.project, env: context.env },
    ),
    `${label} Kit 3.1 action`,
  );
  const kitView = normalizeCandidateView(
    parseJson(kitResult, `${label} Kit 3.1 action`),
    definition,
    `${label} Kit 3.1 action`,
  );

  const actions = await collectSurfaceActions({
    context,
    hyper,
    label: `${label} Hyper`,
    taskId: definition.taskId,
    goal: `${definition.profile} compatibility proof`,
    // Staged here, between checkpoint and guard, because `guard --staged` needs
    // an index and the four preceding surfaces were pinned against a clean one.
    beforeGuard: () => context.runGit(["add", "."], `${label} candidate staging`),
    // This pair's Hyper predates the MCP `availability` field.
    requireAvailability: false,
  });

  return {
    artifacts: await readAssuranceArtifacts(context, definition),
    humanApproval: definition.humanApproval,
    id: definition.id,
    kit: kitView,
    profile: definition.profile,
    surfaces: DEFINITION.surfaces.map((id) => ({
      id,
      ...normalizeCandidateView(actions.get(id), definition, `${label} Hyper ${id}`),
    })),
    taskId: definition.taskId,
  };
}
