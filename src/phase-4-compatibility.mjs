import path from "node:path";
import process from "node:process";
import { readFile, writeFile } from "node:fs/promises";

import {
  canonicalStringify,
  cleanupOwnedRoot,
  createOwnedRoot,
  sha256Hex,
} from "./compatibility-lab.mjs";
import {
  createRealProject,
  packAndInstall,
  parseJson,
  requireCompleted,
  runExact,
  toolVersion,
} from "./phase-2-compatibility.mjs";
import {
  collectSurfaceActions,
  compatibilityActionView,
  exactKeys,
  exactValue,
  plain,
  prepareEvidence,
  projectActionView,
  validateHotspots,
} from "./phase-3-compatibility.mjs";

const HASH = /^[0-9a-f]{64}$/u;
const PREFIXED_HASH = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

/**
 * Phase 4 pins the pair that Phase 3's frozen evidence cannot describe.
 *
 * Kit advanced past the accepted Phase 3 baseline `d92364e` with four
 * enforcement-hole fixes and local review-decision signature verification
 * (VSP025, Kit ADR 0003). Those commits change gate, policy, validator, and
 * diff behavior — exactly the strict-authority surfaces Hyper consumes — so
 * the Phase 3 report no longer describes the shipped pair.
 *
 * `schemas/workflow-action/` is untouched across that range, so every row here
 * expects the unchanged WorkflowAction 3.2 schema hash. Proving that is the
 * point: the enforcement corrections must be additive at the wire contract.
 */
export const PHASE_4_COMPATIBILITY_DEFINITION = deepFreeze({
  compatibility: [
    {
      // The row that matters most: corrected Kit against a Hyper that predates
      // the corrections. Proves the enforcement fixes are additive.
      expectedProtocol: "3.2",
      expectedSchemaHash:
        "sha256:77dcaba51ef8e1a78064680077f8bcc48c081d8025596c6cc8df9ea7873d68e9",
      hyper: "hyperOld",
      id: "new_kit_old_hyper",
      kit: "kitNew",
    },
    {
      expectedProtocol: "3.2",
      expectedSchemaHash:
        "sha256:77dcaba51ef8e1a78064680077f8bcc48c081d8025596c6cc8df9ea7873d68e9",
      hyper: "hyperNew",
      id: "old_kit_new_hyper",
      kit: "kitOld",
    },
    {
      expectedProtocol: "3.2",
      expectedSchemaHash:
        "sha256:77dcaba51ef8e1a78064680077f8bcc48c081d8025596c6cc8df9ea7873d68e9",
      hyper: "hyperNew",
      id: "new_kit_new_hyper",
      kit: "kitNew",
    },
  ],
  packages: {
    hyperNew: {
      commit: "61858199d90bffafb062bde61453f5def6357efa",
      tree: "a7be744b06510443fe97a06b6aa5c214b1bad0f1",
    },
    hyperOld: {
      commit: "cda0c6ce43abc6a69f4a436026d482e95ed74a2c",
      tree: "9694a2d7e36215ee95336ade735f1a5426698187",
    },
    kitNew: {
      commit: "3a8901b9b9fe788a0be98f247c75f9715db24723",
      tree: "74740a41b227ec73561e4adf09dd53bf02c2eff7",
    },
    kitOld: {
      commit: "d92364e8b3fd9d38771bcfe1df18fb9434a8ad4e",
      tree: "6aa999a59ad7bd3b77f6b85bc07fabd6575d9f95",
    },
  },
  scenarios: [
    {
      assuranceVerdict: "inconclusive",
      flow: "accepted",
      humanApproval: false,
      id: "routine_accepted",
      profile: "routine",
      reviewStatus: "current",
      riskFactors: [],
      riskLevel: "low",
      summaryState: "available",
      taskClass: "documentation",
      taskId: "T001",
      testIndependence: "pre_existing",
    },
    {
      assuranceVerdict: "inconclusive",
      flow: "rejected",
      humanApproval: false,
      id: "behavioral_rejected",
      profile: "behavioral",
      reviewStatus: "rejected",
      riskFactors: [],
      riskLevel: "medium",
      summaryState: "available",
      taskClass: "bounded_feature",
      taskId: "T001",
      testIndependence: "pre_approved",
    },
    {
      assuranceVerdict: "inconclusive",
      flow: "stale",
      humanApproval: true,
      id: "critical_stale",
      profile: "critical",
      reviewStatus: "stale",
      riskFactors: [{ code: "authorization", version: "1.0" }],
      riskLevel: "high",
      summaryState: "available",
      taskClass: "security",
      taskId: "T001",
      testIndependence: "pre_approved",
    },
    {
      assuranceVerdict: "inconclusive",
      flow: "inconclusive",
      humanApproval: true,
      id: "critical_inconclusive",
      profile: "critical",
      reviewStatus: "missing",
      riskFactors: [{ code: "authorization", version: "1.0" }],
      riskLevel: "high",
      summaryState: "available",
      taskClass: "security",
      taskId: "T001",
      testIndependence: "pre_approved",
    },
  ],
  schemaHash: "sha256:77dcaba51ef8e1a78064680077f8bcc48c081d8025596c6cc8df9ea7873d68e9",
  surfaces: ["run", "next", "resume", "checkpoint", "guard", "mcp"],
});

export const PHASE_4_COMPATIBILITY_SHA256 = sha256Hex(
  canonicalStringify(PHASE_4_COMPATIBILITY_DEFINITION),
);

/**
 * Observed once against the pinned pair and frozen here, so a later run that
 * silently changes Kit's verdict, next command, action identity, packed bytes,
 * or mandatory hotspot set fails instead of quietly publishing new semantics.
 *
 * These values are expected to differ from Phase 3's: the enforcement fixes
 * change policy defaults, so the canonical action content legitimately moved.
 * What must not move is the protocol, the schema hash, or agreement between
 * Kit and every Hyper surface.
 */
const PHASE_4_EXPECTED_SEMANTICS = deepFreeze({
  /**
   * Deliberately does NOT freeze a compatibility-row `actionId`.
   *
   * The canonical action identity is project-instance specific: each row builds
   * a fresh repository via `createRealProject`, and two runs over byte-identical
   * packages produce different action IDs. Measured directly — same packed Kit
   * and Hyper, two consecutive journeys, `sha256:5d2c3fa0…` then
   * `sha256:2fd047aa…`.
   *
   * Phase 3 froze this field, which is why its compatibility rows cannot be
   * reproduced by a fresh run; its stored report verifies only because it
   * carries the very values that produced the constants. Freezing an
   * unreproducible value is not evidence, so Phase 4 pins the properties that
   * are actually invariant — the verdict and the exact next command — while
   * within-run cross-surface equality still binds every surface to one
   * identical action, including its ID.
   */
  compatibility: {
    new_kit_old_hyper: {
      actionVerdict: "ready",
      nextCommand: "visp verify --task T001",
    },
    old_kit_new_hyper: {
      actionVerdict: "ready",
      nextCommand: "visp verify --task T001",
    },
    new_kit_new_hyper: {
      actionVerdict: "ready",
      nextCommand: "visp verify --task T001",
    },
  },
  packages: {
    // hyperOld and kitOld repack to the exact bytes Phase 3 accepted for the
    // same commits, which is the determinism check for this harness.
    hyperNew: "0046ca392bbd08f58b0ebb8c0156710bfa94a79e3c4be8ba5aaf18fd4c19bd55",
    hyperOld: "5a917a5111e0178c9e712655a366e7536bc5f5873c3c6800c261423e3829d43d",
    kitNew: "d8df0c8c468ac98375c78c8f12d4df35846cfcf3e6dabf505051c6a5d2df49f9",
    kitOld: "6ab0a137018095685088d688dea889147a763bd4d2b8601ada2f9e29b6bc1f8d",
  },
  // Every verdict, next command, and mandatory hotspot below is byte-identical
  // to Phase 3's accepted observation. The enforcement fixes moved the action
  // identity because policy defaults changed; they did not move a single
  // assurance semantic.
  scenarios: {
    routine_accepted: {
      actionVerdict: "ready",
      hotspots: [
        ["HS-10-8525b69745abc7c139ca0982104f8dea9c2f6ce55667d519cad30eed74412d9f", "validation_command_change"],
        ["HS-20-2dacd3d42d42d17dd80208beac8cda8e049122ac826bb5f01caaca39f071502b", "unmapped_change"],
        ["HS-20-4cc0ee3b392fc85e087ed9ac0a8a2683497610ad8b532a7dbd3df7b3b0e42925", "inconclusive_evidence"],
      ],
      nextCommand: "visp verify --task T001",
      reviewRequired: true,
    },
    behavioral_rejected: {
      actionVerdict: "ready",
      hotspots: [
        ["HS-10-02736d27c87c19d131d2d80711ee1a1ee4edb6a1ea764863600f6313a0184e57", "validation_command_change"],
        ["HS-20-2d70548b253a512e581e57a27be48f9b09d2dde86f07b6af4744997a3bb2a36c", "unmapped_change"],
        ["HS-20-4cc0ee3b392fc85e087ed9ac0a8a2683497610ad8b532a7dbd3df7b3b0e42925", "inconclusive_evidence"],
      ],
      nextCommand: "visp verify --task T001",
      reviewRequired: true,
    },
    critical_stale: {
      actionVerdict: "inconclusive",
      hotspots: [
        ["HS-00-5fe04c2895e241871da2faaeeba28781e91c9a3eba4e11af340de45e37b77729", "permissions"],
        ["HS-10-0e4bfbb88987d6e8a0bd23c1a940e6ca54fba8d5f6be966c1efc53fac1de84d1", "validation_command_change"],
        ["HS-20-359ec31c990b193e9a991e268788e4326c475c4acd8c72bb4b044b05ef8320c1", "unmapped_change"],
        ["HS-20-4cc0ee3b392fc85e087ed9ac0a8a2683497610ad8b532a7dbd3df7b3b0e42925", "inconclusive_evidence"],
      ],
      nextCommand: "visp verify --task T001",
      reviewRequired: true,
    },
    critical_inconclusive: {
      actionVerdict: "ready",
      hotspots: [
        ["HS-00-61493e67cf93703897e0888cd4eff13b362ab5874b6e70129da23f57f696099f", "permissions"],
        ["HS-10-9dda892742a0ca799735ece91a911594053df93a103bfa7996f7dc604daeb6fa", "validation_command_change"],
        ["HS-20-4cc0ee3b392fc85e087ed9ac0a8a2683497610ad8b532a7dbd3df7b3b0e42925", "inconclusive_evidence"],
        ["HS-20-e4e34d3ac69c7420a8646d4d4e5d8a39c026eda59d98928ffd58d967acbcfc6d", "unmapped_change"],
      ],
      nextCommand: "visp verify --task T001",
      reviewRequired: true,
    },
  },
});

function validatePackage(record, id) {
  const expected = PHASE_4_COMPATIBILITY_DEFINITION.packages[id];
  const kit = id.startsWith("kit");
  const name = kit ? "visp-kit" : "visp-hyper-agent";
  const bin = kit ? "visp" : "visp-hyper";
  exactKeys(record, ["install", "pack", "runtimeLock", "source"], `Phase 4 package ${id}`);
  exactValue(record.source, expected, `Phase 4 package ${id} source`);
  if (!COMMIT.test(record.source.commit) || !COMMIT.test(record.source.tree)
    || record.pack?.byteEquality !== true
    || record.pack?.first?.sha256 !== record.pack?.second?.sha256
    || !HASH.test(record.pack?.first?.sha256 ?? "")
    || record.install?.offline !== true
    || record.install?.lifecycleScriptsDisabled !== true
    || !record.install?.bins?.some(
      (entry) => entry.name === bin
        && entry.target === `node_modules/${name}/dist/index.js`
        && HASH.test(entry.sha256),
    )
    || !HASH.test(record.runtimeLock?.materializedSha256 ?? "")
    || !HASH.test(record.runtimeLock?.templateSha256 ?? "")) {
    throw new Error(`Phase 4 package ${id} lacks exact packed/install provenance`);
  }
  exactValue(
    record.pack.first.sha256,
    PHASE_4_EXPECTED_SEMANTICS.packages[id],
    `Phase 4 package ${id} accepted pack hash`,
  );
}

function validateReviewDecision(value, definition, label) {
  exactKeys(value, ["decisionHash", "reason", "required", "status"], label);
  if (typeof value.required !== "boolean"
    || value.status !== definition.reviewStatus
    || typeof value.reason !== "string"
    || value.reason.length === 0) {
    throw new Error(`${label} drifted from Kit's expected golden observation`);
  }
  const expectsHash = definition.reviewStatus === "current"
    || definition.reviewStatus === "rejected"
    || definition.reviewStatus === "stale";
  if (expectsHash ? !PREFIXED_HASH.test(value.decisionHash ?? "") : value.decisionHash !== null) {
    throw new Error(`${label} decision hash is inconsistent with the observed status`);
  }
}

function validateActionView(view, definition, label) {
  exactKeys(
    view,
    [
      "actionId",
      "actionVerdict",
      "assuranceSummary",
      "assuranceVerdict",
      "caseHash",
      "mandatoryHotspots",
      "nextCommand",
      "protocolVersion",
      "reviewDecision",
      "schemaHash",
    ],
    label,
  );
  if (!PREFIXED_HASH.test(view.actionId)
    || view.protocolVersion !== "3.2"
    || view.schemaHash !== PHASE_4_COMPATIBILITY_DEFINITION.schemaHash
    || !["ready", "blocked", "inconclusive"].includes(view.actionVerdict)
    || typeof view.nextCommand !== "string"
    || view.nextCommand.length === 0) {
    throw new Error(`${label} action identity or exact next command is invalid`);
  }
  exactKeys(
    view.assuranceSummary,
    ["artifact", "caseHash", "mandatoryHotspots", "reviewDecision", "state", "verdict", "version"],
    `${label} assurance summary`,
  );
  if (view.assuranceSummary.state !== definition.summaryState
    || view.assuranceSummary.state !== "available"
    || view.assuranceSummary.version !== "1.0"
    || !PREFIXED_HASH.test(view.assuranceSummary.caseHash ?? "")
    || !PREFIXED_HASH.test(view.assuranceSummary.artifact?.contentHash ?? "")
    || typeof view.assuranceSummary.artifact?.path !== "string"
    || view.assuranceSummary.artifact.path.includes("..")
    || view.assuranceSummary.verdict !== definition.assuranceVerdict) {
    throw new Error(`${label} assurance summary drifted from Kit's golden observation`);
  }
  validateReviewDecision(
    view.assuranceSummary.reviewDecision,
    definition,
    `${label} assurance review decision`,
  );
  validateHotspots(view.assuranceSummary.mandatoryHotspots, `${label} mandatory hotspots`);
  exactValue(
    {
      actionVerdict: view.actionVerdict,
      hotspots: view.assuranceSummary.mandatoryHotspots.map(({ id, category }) => [id, category]),
      nextCommand: view.nextCommand,
      reviewRequired: view.assuranceSummary.reviewDecision.required,
    },
    PHASE_4_EXPECTED_SEMANTICS.scenarios[definition.id],
    `${label} frozen semantic observation`,
  );
  exactValue(view.caseHash, view.assuranceSummary.caseHash, `${label} case hash`);
  exactValue(view.assuranceVerdict, view.assuranceSummary.verdict, `${label} assurance verdict`);
  exactValue(view.reviewDecision, view.assuranceSummary.reviewDecision, `${label} review decision`);
  exactValue(
    view.mandatoryHotspots,
    view.assuranceSummary.mandatoryHotspots,
    `${label} mandatory hotspots`,
  );
}

export function createPhase4CompatibilityReport(input) {
  plain(input, "Phase 4 report input");
  const report = {
    compatibility: structuredClone(input.compatibility),
    definitionSha256: PHASE_4_COMPATIBILITY_SHA256,
    environment: structuredClone(input.environment),
    packages: structuredClone(input.packages),
    scenarios: structuredClone(input.scenarios),
    schemaHash: PHASE_4_COMPATIBILITY_DEFINITION.schemaHash,
    schemaVersion: "visp.phase-4-compatibility.evidence.v1",
    summary: {
      compatibilityRowsPassed: input.compatibility.length,
      scenariosPassed: input.scenarios.length,
      surfacesPassed: input.scenarios.reduce(
        (count, scenario) => count + scenario.surfaces.length,
        0,
      ),
      testsPassed: true,
    },
  };
  report.reportSha256 = sha256Hex(canonicalStringify(report));
  verifyPhase4CompatibilityReport(report);
  return JSON.parse(canonicalStringify(report));
}

export function verifyPhase4CompatibilityReport(report) {
  exactKeys(
    report,
    [
      "compatibility",
      "definitionSha256",
      "environment",
      "packages",
      "reportSha256",
      "scenarios",
      "schemaHash",
      "schemaVersion",
      "summary",
    ],
    "Phase 4 report",
  );
  if (report.schemaVersion !== "visp.phase-4-compatibility.evidence.v1"
    || report.definitionSha256 !== PHASE_4_COMPATIBILITY_SHA256
    || report.schemaHash !== PHASE_4_COMPATIBILITY_DEFINITION.schemaHash
    || !HASH.test(report.reportSha256)) {
    throw new Error("Phase 4 report identity is invalid");
  }
  const unhashed = structuredClone(report);
  delete unhashed.reportSha256;
  if (report.reportSha256 !== sha256Hex(canonicalStringify(unhashed))) {
    throw new Error("Phase 4 report hash does not match its content");
  }
  exactKeys(report.packages, ["hyperNew", "hyperOld", "kitNew", "kitOld"], "Phase 4 packages");
  for (const id of Object.keys(PHASE_4_COMPATIBILITY_DEFINITION.packages)) {
    validatePackage(report.packages[id], id);
  }
  exactKeys(
    report.environment,
    ["architecture", "git", "node", "npm", "operatingSystem", "pnpm"],
    "Phase 4 environment",
  );
  if (Object.values(report.environment).some(
    (value) => typeof value !== "string" || value.length === 0,
  )) {
    throw new Error("Phase 4 environment is incomplete");
  }
  if (!Array.isArray(report.compatibility)
    || report.compatibility.length !== PHASE_4_COMPATIBILITY_DEFINITION.compatibility.length) {
    throw new Error("Phase 4 report must contain exactly three compatibility rows");
  }
  report.compatibility.forEach((row, index) => {
    const definition = PHASE_4_COMPATIBILITY_DEFINITION.compatibility[index];
    exactKeys(row, ["id", "surfaces"], `Phase 4 compatibility ${definition.id}`);
    if (row.id !== definition.id
      || !Array.isArray(row.surfaces)
      || row.surfaces.length !== PHASE_4_COMPATIBILITY_DEFINITION.surfaces.length) {
      throw new Error(`Phase 4 compatibility ${definition.id} drifted`);
    }
    let expectedView;
    row.surfaces.forEach((surface, surfaceIndex) => {
      const surfaceId = PHASE_4_COMPATIBILITY_DEFINITION.surfaces[surfaceIndex];
      exactKeys(surface, ["id", "view"], `Phase 4 compatibility ${definition.id} surface`);
      exactKeys(
        surface.view,
        [
          "actionId",
          "actionVerdict",
          "nextCommand",
          "protocolVersion",
          "schemaHash",
          "selectionMode",
        ],
        `Phase 4 compatibility ${definition.id} ${surfaceId}`,
      );
      if (surface.id !== surfaceId
        || surface.view.protocolVersion !== definition.expectedProtocol
        || surface.view.schemaHash !== definition.expectedSchemaHash
        || surface.view.selectionMode !== "advertised"
        || !PREFIXED_HASH.test(surface.view.actionId)
        || !["ready", "blocked", "inconclusive"].includes(surface.view.actionVerdict)
        || typeof surface.view.nextCommand !== "string"
        || surface.view.nextCommand.length === 0) {
        throw new Error(`Phase 4 compatibility ${definition.id} ${surfaceId} drifted`);
      }
      exactValue(
        {
          actionVerdict: surface.view.actionVerdict,
          nextCommand: surface.view.nextCommand,
        },
        PHASE_4_EXPECTED_SEMANTICS.compatibility[definition.id],
        `Phase 4 compatibility ${definition.id} ${surfaceId} frozen semantic observation`,
      );
      expectedView ??= surface.view;
      exactValue(
        surface.view,
        expectedView,
        `Phase 4 compatibility ${definition.id} ${surfaceId} equality`,
      );
    });
  });
  if (!Array.isArray(report.scenarios)
    || report.scenarios.length !== PHASE_4_COMPATIBILITY_DEFINITION.scenarios.length) {
    throw new Error("Phase 4 report must contain exactly four golden scenarios");
  }
  report.scenarios.forEach((scenario, index) => {
    const definition = PHASE_4_COMPATIBILITY_DEFINITION.scenarios[index];
    exactKeys(scenario, ["flow", "id", "kit", "profile", "surfaces"], `Phase 4 ${definition.id}`);
    if (scenario.id !== definition.id
      || scenario.flow !== definition.flow
      || scenario.profile !== definition.profile) {
      throw new Error(`Phase 4 scenario ${definition.id} identity drifted`);
    }
    validateActionView(scenario.kit, definition, `Phase 4 ${definition.id} Kit action`);
    if (!Array.isArray(scenario.surfaces)
      || scenario.surfaces.length !== PHASE_4_COMPATIBILITY_DEFINITION.surfaces.length) {
      throw new Error(`Phase 4 ${definition.id} must contain exactly six surfaces`);
    }
    scenario.surfaces.forEach((surface, surfaceIndex) => {
      const expectedId = PHASE_4_COMPATIBILITY_DEFINITION.surfaces[surfaceIndex];
      exactKeys(surface, ["id", "view"], `Phase 4 ${definition.id} surface`);
      if (surface.id !== expectedId) {
        throw new Error(`Phase 4 ${definition.id} surface order drifted`);
      }
      validateActionView(surface.view, definition, `Phase 4 ${definition.id} ${expectedId}`);
      exactValue(surface.view, scenario.kit, `Phase 4 ${definition.id} ${expectedId} equality`);
    });
  });
  exactValue(report.summary, {
    compatibilityRowsPassed: 3,
    scenariosPassed: 4,
    surfacesPassed: 24,
    testsPassed: true,
  }, "Phase 4 summary");
  const rendered = canonicalStringify(report);
  if (/visp-compatibility-lab-|timestamp|generatedAt|checkedAt|duration|\/tmp\//iu.test(rendered)) {
    throw new Error("Phase 4 report contains unstable runtime content");
  }
  return true;
}

async function runGoldenScenario({ definition, hyper, kit, root }) {
  const context = await createRealProject({ definition, hyper, kit, root });
  await prepareEvidence({ context, definition });
  const kitResult = requireCompleted(
    await runExact(
      kit.executable,
      ["next", context.project, "--format", "json", "--protocol", "3.2"],
      { cwd: context.project, env: context.env },
    ),
    `Phase 4 ${definition.id} Kit action`,
  );
  const kitView = projectActionView(
    parseJson(kitResult, `Phase 4 ${definition.id} Kit action`),
    PHASE_4_COMPATIBILITY_DEFINITION.schemaHash,
  );
  const actions = await collectSurfaceActions({
    context,
    hyper,
    label: `Phase 4 ${definition.id}`,
    taskId: definition.taskId,
  });
  return {
    flow: definition.flow,
    id: definition.id,
    kit: kitView,
    profile: definition.profile,
    surfaces: PHASE_4_COMPATIBILITY_DEFINITION.surfaces.map((id) => ({
      id,
      view: projectActionView(actions.get(id), PHASE_4_COMPATIBILITY_DEFINITION.schemaHash),
    })),
  };
}

/**
 * Runs one compatibility row against a packed Kit and Hyper.
 *
 * The scenario, surface list, and label are parameters rather than reads of the
 * Phase 4 constant so a later phase can pin its own pair without copying this
 * journey. Phase 4 passes its own frozen values below, so its behaviour and its
 * committed evidence are unchanged.
 */
export async function runPairCompatibilityJourney({
  definition,
  hyper,
  kit,
  root,
  scenario,
  surfaces,
  label,
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

async function runCompatibilityJourney({ definition, hyper, kit, root }) {
  return runPairCompatibilityJourney({
    definition,
    hyper,
    kit,
    root,
    scenario: PHASE_4_COMPATIBILITY_DEFINITION.scenarios[0],
    surfaces: PHASE_4_COMPATIBILITY_DEFINITION.surfaces,
    label: "Phase 4",
  });
}

export async function runPackedPhase4Compatibility(input) {
  plain(input, "Phase 4 runner input");
  for (const field of [
    "hyperRepositoryRoot",
    "kitRepositoryRoot",
    "offlineCacheSource",
    "offlineStoreSource",
    "packageManagerCommand",
    "npmCommand",
  ]) {
    if (typeof input[field] !== "string" || input[field].length === 0) {
      throw new TypeError(`${field} must be a non-empty path`);
    }
  }
  if (input.keepOwnedRoot !== undefined && typeof input.keepOwnedRoot !== "boolean") {
    throw new TypeError("keepOwnedRoot must be a boolean");
  }
  const owned = await createOwnedRoot();
  try {
    const packages = {};
    for (const [id, definition] of Object.entries(PHASE_4_COMPATIBILITY_DEFINITION.packages)) {
      const kind = id.startsWith("kit") ? "kit" : "hyper";
      packages[id] = await packAndInstall({
        definition,
        kind,
        offlineCacheSource: input.offlineCacheSource,
        offlineStoreSource: input.offlineStoreSource,
        npmCommand: input.npmCommand,
        ownedRoot: owned.root,
        packageManagerCommand: input.packageManagerCommand,
        repositoryRoot: kind === "kit" ? input.kitRepositoryRoot : input.hyperRepositoryRoot,
      });
    }
    const compatibility = [];
    for (const definition of PHASE_4_COMPATIBILITY_DEFINITION.compatibility) {
      const rowRoot = await createOwnedRoot({ baseDirectory: owned.root });
      compatibility.push(await runCompatibilityJourney({
        definition,
        hyper: packages[definition.hyper],
        kit: packages[definition.kit],
        root: rowRoot.root,
      }));
    }
    const scenarios = [];
    for (const definition of PHASE_4_COMPATIBILITY_DEFINITION.scenarios) {
      const scenarioRoot = await createOwnedRoot({ baseDirectory: owned.root });
      scenarios.push(await runGoldenScenario({
        definition,
        hyper: packages.hyperNew,
        kit: packages.kitNew,
        root: scenarioRoot.root,
      }));
    }
    const report = createPhase4CompatibilityReport({
      compatibility,
      environment: {
        architecture: process.arch,
        git: await toolVersion("git"),
        node: process.version,
        npm: await toolVersion(input.npmCommand),
        operatingSystem: process.platform,
        pnpm: await toolVersion(input.packageManagerCommand),
      },
      packages: Object.fromEntries(
        Object.entries(packages).map(([id, value]) => [id, value.report]),
      ),
      scenarios,
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
    if (input.keepOwnedRoot !== true) await cleanupOwnedRoot({ root: owned.root });
  }
}

/** Derives the freezable semantic observations from a completed report. */
export function observedPhase4Semantics(report) {
  return {
    compatibility: Object.fromEntries(report.compatibility.map((row) => [
      row.id,
      {
        actionVerdict: row.surfaces[0].view.actionVerdict,
        nextCommand: row.surfaces[0].view.nextCommand,
      },
    ])),
    packages: Object.fromEntries(
      Object.entries(report.packages).map(([id, value]) => [id, value.pack.first.sha256]),
    ),
    scenarios: Object.fromEntries(report.scenarios.map((scenario) => [
      scenario.id,
      {
        actionVerdict: scenario.kit.actionVerdict,
        hotspots: scenario.kit.mandatoryHotspots.map(({ id, category }) => [id, category]),
        nextCommand: scenario.kit.nextCommand,
        reviewRequired: scenario.kit.reviewDecision.required,
      },
    ])),
  };
}
