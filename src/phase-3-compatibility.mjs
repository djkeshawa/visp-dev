import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  canonicalStringify,
  cleanupOwnedRoot,
  createOwnedRoot,
  sha256Hex,
} from "./compatibility-lab.mjs";
import {
  createRealProject,
  packAndInstall,
  parseFrame,
  parseJson,
  requireCompleted,
  runExact,
  toolVersion,
} from "./phase-2-compatibility.mjs";

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

export const PHASE_3_COMPATIBILITY_DEFINITION = deepFreeze({
  compatibility: [
    {
      expectedProtocol: "3.1",
      expectedSchemaHash:
        "sha256:41ffa28fcd4476ea1812ff307df67a7ab7edb5b2cf4d6c11955d34d4aad74d4d",
      hyper: "hyperOld",
      id: "new_kit_old_hyper",
      kit: "kitNew",
    },
    {
      expectedProtocol: "3.1",
      expectedSchemaHash:
        "sha256:41ffa28fcd4476ea1812ff307df67a7ab7edb5b2cf4d6c11955d34d4aad74d4d",
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

export const PHASE_3_COMPATIBILITY_SHA256 = sha256Hex(
  canonicalStringify(PHASE_3_COMPATIBILITY_DEFINITION),
);

const PHASE_3_EXPECTED_SEMANTICS = deepFreeze({
  compatibility: {
    new_kit_old_hyper: {
      actionId: "sha256:8423630645be62bb4fb6bedf7aa28b24bc4417dd5695c76d05ebb3e79dd1e891",
      actionVerdict: "ready",
      nextCommand: "visp verify --task T001",
    },
    old_kit_new_hyper: {
      actionId: "sha256:548298798ff3f719750ba93e0a18449a9b0ecffd677d20b9e1b2d8d30254be72",
      actionVerdict: "ready",
      nextCommand: "visp verify --task T001",
    },
    new_kit_new_hyper: {
      actionId: "sha256:9315dd8821ea5e2917afc5456d2e42bdb88c38a7abe8a10add368249707852ec",
      actionVerdict: "ready",
      nextCommand: "visp verify --task T001",
    },
  },
  packages: {
    hyperNew: "5a917a5111e0178c9e712655a366e7536bc5f5873c3c6800c261423e3829d43d",
    hyperOld: "95e91eac9b3bab510cf801d67815ddd961022d008176dd4780e490843349701a",
    kitNew: "6ab0a137018095685088d688dea889147a763bd4d2b8601ada2f9e29b6bc1f8d",
    kitOld: "5be534dad6fc6e76ca803bf3dcd7316bd6ebe3cd91053e4b3993c6bf2b0798a5",
  },
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

function plain(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  plain(value, label);
  if (canonicalStringify(Object.keys(value).sort()) !== canonicalStringify([...keys].sort())) {
    throw new Error(`${label} has an unexpected field set`);
  }
}

function exactValue(actual, expected, label) {
  if (canonicalStringify(actual) !== canonicalStringify(expected)) {
    throw new Error(`${label} drifted`);
  }
}

function validatePackage(record, id) {
  const expected = PHASE_3_COMPATIBILITY_DEFINITION.packages[id];
  const kit = id.startsWith("kit");
  const name = kit ? "visp-kit" : "visp-hyper-agent";
  const bin = kit ? "visp" : "visp-hyper";
  exactKeys(record, ["install", "pack", "runtimeLock", "source"], `Phase 3 package ${id}`);
  exactValue(record.source, expected, `Phase 3 package ${id} source`);
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
    throw new Error(`Phase 3 package ${id} lacks exact packed/install provenance`);
  }
  exactValue(
    record.pack.first.sha256,
    PHASE_3_EXPECTED_SEMANTICS.packages[id],
    `Phase 3 package ${id} accepted pack hash`,
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

function validateHotspots(hotspots, label) {
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
    || view.schemaHash !== PHASE_3_COMPATIBILITY_DEFINITION.schemaHash
    || !["ready", "blocked", "inconclusive"].includes(view.actionVerdict)
    || typeof view.nextCommand !== "string"
    || view.nextCommand.length === 0) {
    throw new Error(`${label} action identity or exact next command is invalid`);
  }
  exactKeys(
    view.assuranceSummary,
    [
      "artifact",
      "caseHash",
      "mandatoryHotspots",
      "reviewDecision",
      "state",
      "verdict",
      "version",
    ],
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
      hotspots: view.assuranceSummary.mandatoryHotspots.map(
        ({ id, category }) => [id, category],
      ),
      nextCommand: view.nextCommand,
      reviewRequired: view.assuranceSummary.reviewDecision.required,
    },
    PHASE_3_EXPECTED_SEMANTICS.scenarios[definition.id],
    `${label} frozen semantic observation`,
  );
  exactValue(view.caseHash, view.assuranceSummary.caseHash, `${label} case hash`);
  exactValue(view.assuranceVerdict, view.assuranceSummary.verdict, `${label} assurance verdict`);
  exactValue(
    view.reviewDecision,
    view.assuranceSummary.reviewDecision,
    `${label} review decision`,
  );
  exactValue(
    view.mandatoryHotspots,
    view.assuranceSummary.mandatoryHotspots,
    `${label} mandatory hotspots`,
  );
}

export function createPhase3CompatibilityReport(input) {
  plain(input, "Phase 3 report input");
  const report = {
    compatibility: structuredClone(input.compatibility),
    definitionSha256: PHASE_3_COMPATIBILITY_SHA256,
    environment: structuredClone(input.environment),
    packages: structuredClone(input.packages),
    scenarios: structuredClone(input.scenarios),
    schemaHash: PHASE_3_COMPATIBILITY_DEFINITION.schemaHash,
    schemaVersion: "visp.phase-3-compatibility.evidence.v1",
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
  verifyPhase3CompatibilityReport(report);
  return JSON.parse(canonicalStringify(report));
}

export function verifyPhase3CompatibilityReport(report) {
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
    "Phase 3 report",
  );
  if (report.schemaVersion !== "visp.phase-3-compatibility.evidence.v1"
    || report.definitionSha256 !== PHASE_3_COMPATIBILITY_SHA256
    || report.schemaHash !== PHASE_3_COMPATIBILITY_DEFINITION.schemaHash
    || !HASH.test(report.reportSha256)) {
    throw new Error("Phase 3 report identity is invalid");
  }
  const unhashed = structuredClone(report);
  delete unhashed.reportSha256;
  if (report.reportSha256 !== sha256Hex(canonicalStringify(unhashed))) {
    throw new Error("Phase 3 report hash does not match its content");
  }
  exactKeys(report.packages, ["hyperNew", "hyperOld", "kitNew", "kitOld"], "Phase 3 packages");
  for (const id of Object.keys(PHASE_3_COMPATIBILITY_DEFINITION.packages)) {
    validatePackage(report.packages[id], id);
  }
  exactKeys(
    report.environment,
    ["architecture", "git", "node", "npm", "operatingSystem", "pnpm"],
    "Phase 3 environment",
  );
  if (Object.values(report.environment).some(
    (value) => typeof value !== "string" || value.length === 0,
  )) {
    throw new Error("Phase 3 environment is incomplete");
  }
  if (!Array.isArray(report.compatibility)
    || report.compatibility.length !== PHASE_3_COMPATIBILITY_DEFINITION.compatibility.length) {
    throw new Error("Phase 3 report must contain exactly three compatibility rows");
  }
  report.compatibility.forEach((row, index) => {
    const definition = PHASE_3_COMPATIBILITY_DEFINITION.compatibility[index];
    exactKeys(row, ["id", "surfaces"], `Phase 3 compatibility ${definition.id}`);
    if (row.id !== definition.id
      || !Array.isArray(row.surfaces)
      || row.surfaces.length !== PHASE_3_COMPATIBILITY_DEFINITION.surfaces.length) {
      throw new Error(`Phase 3 compatibility ${definition.id} drifted`);
    }
    let expectedView;
    row.surfaces.forEach((surface, surfaceIndex) => {
      const surfaceId = PHASE_3_COMPATIBILITY_DEFINITION.surfaces[surfaceIndex];
      exactKeys(surface, ["id", "view"], `Phase 3 compatibility ${definition.id} surface`);
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
        `Phase 3 compatibility ${definition.id} ${surfaceId}`,
      );
      if (surface.id !== surfaceId
        || surface.view.protocolVersion !== definition.expectedProtocol
        || surface.view.schemaHash !== definition.expectedSchemaHash
        || surface.view.selectionMode !== "advertised"
        || !PREFIXED_HASH.test(surface.view.actionId)
        || !["ready", "blocked", "inconclusive"].includes(surface.view.actionVerdict)
        || typeof surface.view.nextCommand !== "string"
        || surface.view.nextCommand.length === 0) {
        throw new Error(`Phase 3 compatibility ${definition.id} ${surfaceId} drifted`);
      }
      exactValue(
        {
          actionId: surface.view.actionId,
          actionVerdict: surface.view.actionVerdict,
          nextCommand: surface.view.nextCommand,
        },
        PHASE_3_EXPECTED_SEMANTICS.compatibility[definition.id],
        `Phase 3 compatibility ${definition.id} ${surfaceId} frozen semantic observation`,
      );
      expectedView ??= surface.view;
      exactValue(
        surface.view,
        expectedView,
        `Phase 3 compatibility ${definition.id} ${surfaceId} equality`,
      );
    });
  });
  if (!Array.isArray(report.scenarios)
    || report.scenarios.length !== PHASE_3_COMPATIBILITY_DEFINITION.scenarios.length) {
    throw new Error("Phase 3 report must contain exactly four golden scenarios");
  }
  report.scenarios.forEach((scenario, index) => {
    const definition = PHASE_3_COMPATIBILITY_DEFINITION.scenarios[index];
    exactKeys(scenario, ["flow", "id", "kit", "profile", "surfaces"], `Phase 3 ${definition.id}`);
    if (scenario.id !== definition.id
      || scenario.flow !== definition.flow
      || scenario.profile !== definition.profile) {
      throw new Error(`Phase 3 scenario ${definition.id} identity drifted`);
    }
    validateActionView(scenario.kit, definition, `Phase 3 ${definition.id} Kit action`);
    if (!Array.isArray(scenario.surfaces)
      || scenario.surfaces.length !== PHASE_3_COMPATIBILITY_DEFINITION.surfaces.length) {
      throw new Error(`Phase 3 ${definition.id} must contain exactly six surfaces`);
    }
    scenario.surfaces.forEach((surface, surfaceIndex) => {
      const expectedId = PHASE_3_COMPATIBILITY_DEFINITION.surfaces[surfaceIndex];
      exactKeys(surface, ["id", "view"], `Phase 3 ${definition.id} surface`);
      if (surface.id !== expectedId) throw new Error(`Phase 3 ${definition.id} surface order drifted`);
      validateActionView(surface.view, definition, `Phase 3 ${definition.id} ${expectedId}`);
      exactValue(surface.view, scenario.kit, `Phase 3 ${definition.id} ${expectedId} equality`);
    });
  });
  exactValue(report.summary, {
    compatibilityRowsPassed: 3,
    scenariosPassed: 4,
    surfacesPassed: 24,
    testsPassed: true,
  }, "Phase 3 summary");
  const rendered = canonicalStringify(report);
  if (/visp-compatibility-lab-|timestamp|generatedAt|checkedAt|duration|\/tmp\//iu.test(rendered)) {
    throw new Error("Phase 3 report contains unstable runtime content");
  }
  return true;
}

function projectActionView(action, schemaHash) {
  const protocolVersion = action?.protocolVersion ?? action?.source?.protocolVersion;
  const actionId = typeof action?.actionId === "string"
    ? action.actionId
    : action?.actionId?.state === "available"
      ? action.actionId.value
      : null;
  const localSchemaHash = action?.source?.localSchemaHash ?? schemaHash;
  const assuranceSummary = action?.assuranceSummary;
  if (protocolVersion !== "3.2"
    || localSchemaHash !== PHASE_3_COMPATIBILITY_DEFINITION.schemaHash
    || !PREFIXED_HASH.test(actionId ?? "")
    || assuranceSummary?.state !== "available"
    || typeof action?.nextCommand !== "string"
    || !["ready", "blocked", "inconclusive"].includes(action?.verdict)) {
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

function compatibilityActionView(action, definition) {
  const protocolVersion = action?.source?.protocolVersion;
  const actionId = action?.actionId?.state === "available" ? action.actionId.value : null;
  if (protocolVersion !== definition.expectedProtocol
    || action?.source?.selectionMode !== "advertised"
    || action?.source?.localSchemaHash !== definition.expectedSchemaHash
    || !PREFIXED_HASH.test(actionId ?? "")
    || typeof action?.nextCommand !== "string"
    || !["ready", "blocked", "inconclusive"].includes(action?.verdict)) {
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

function mcpAction(result, label) {
  const messages = result.stdout.text.trim().split("\n").map((line) => JSON.parse(line));
  const text = messages.find(({ id }) => id === 2)?.result?.contents?.[0]?.text;
  if (typeof text !== "string") throw new Error(`${label} omitted the canonical action resource`);
  const resource = JSON.parse(text);
  if (resource.availability !== "available") {
    throw new Error(`${label} canonical action resource was unavailable`);
  }
  return resource.envelope.action;
}

async function collectSurfaceActions({ context, hyper, label, taskId }) {
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
  results.set("run", await rawHyper(["run", `${label} installed-binary journey`], "run"));
  results.set("next", await rawHyper(["next"], "next"));
  results.set("resume", await rawHyper(["resume", "--json"], "resume"));
  results.set(
    "checkpoint",
    await rawHyper(["checkpoint", "--task", taskId], "checkpoint"),
  );
  results.set("guard", await rawHyper(["guard", "--staged"], "guard"));
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
  results.set("mcp", await rawHyper(["serve", "--mcp"], "mcp", mcpInput));
  return new Map([
    [
      "run",
      parseFrame(
        results.get("run"),
        "BEGIN_VISP_HYPER_ACTION_V1",
        "END_VISP_HYPER_ACTION_V1",
        `${label} run`,
      ).action,
    ],
    [
      "next",
      parseFrame(
        results.get("next"),
        "BEGIN_VISP_HYPER_ACTION_V1",
        "END_VISP_HYPER_ACTION_V1",
        `${label} next`,
      ).action,
    ],
    ["resume", parseJson(results.get("resume"), `${label} resume`).action],
    [
      "checkpoint",
      parseFrame(
        results.get("checkpoint"),
        "BEGIN_VISP_HYPER_ACTION_V1",
        "END_VISP_HYPER_ACTION_V1",
        `${label} checkpoint`,
      ).action,
    ],
    [
      "guard",
      parseFrame(
        results.get("guard"),
        "BEGIN_VISP_HYPER_ACTION_V1",
        "END_VISP_HYPER_ACTION_V1",
        `${label} guard`,
      ).action,
    ],
    ["mcp", mcpAction(results.get("mcp"), `${label} mcp`)],
  ]);
}

async function prepareEvidence({ context, definition }) {
  const plan = [
    "oracle",
    "plan",
    context.project,
    "--task",
    definition.taskId,
    "--json",
  ];
  if (definition.testIndependence === "pre_approved") {
    plan.push("--pre-approved-test", "tests/profile.test.mjs");
  }
  await context.runKit(plan, `Phase 3 ${definition.id} oracle plan`);
  if (definition.humanApproval) {
    await context.runKit(
      [
        "oracle",
        "approve",
        context.project,
        "--task",
        definition.taskId,
        "--reviewer",
        "phase-3-compatibility-reviewer",
        "--reason",
        "The critical installed-binary oracle was reviewed for compatibility evidence.",
        "--json",
      ],
      `Phase 3 ${definition.id} oracle approval`,
    );
  }
  await context.runKit(
    ["oracle", "lock", context.project, "--task", definition.taskId, "--json"],
    `Phase 3 ${definition.id} oracle lock`,
  );
  await context.runKit(
    ["verify", context.project, "--baseline", "--task", definition.taskId, "--json"],
    `Phase 3 ${definition.id} baseline`,
  );
  await context.runKit(
    ["gate", "implement", context.project, "--task", definition.taskId, "--json"],
    `Phase 3 ${definition.id} implement authorization`,
  );
  const relativeCandidate = definition.profile === "routine"
    ? "docs/profile.md"
    : "src/profile.mjs";
  const candidatePath = path.join(context.project, relativeCandidate);
  const original = await readFile(candidatePath, "utf8");
  await writeFile(candidatePath, `${original.trimEnd()}\n// candidate ${definition.id}\n`);
  await context.runGit(["add", relativeCandidate], `Phase 3 ${definition.id} candidate staging`);
  if (definition.flow !== "inconclusive") {
    await context.runKit(
      ["verify", context.project, "--candidate", "--task", definition.taskId, "--json"],
      `Phase 3 ${definition.id} candidate`,
    );
  }
  await context.runKit(
    ["assurance", "generate", context.project, "--task", definition.taskId, "--json"],
    `Phase 3 ${definition.id} assurance generation`,
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
      "phase-3-compatibility-reviewer",
      "--reason",
      "The installed-binary assurance case and mandatory hotspots were reviewed.",
      "--json",
    ];
    for (const hotspot of mandatory) args.push("--reviewed-hotspot", hotspot);
    await context.runKit(args, `Phase 3 ${definition.id} acceptance`);
  } else if (definition.flow === "rejected") {
    await context.runKit(
      [
        "assurance",
        "reject",
        context.project,
        "--task",
        definition.taskId,
        "--reviewer",
        "phase-3-compatibility-reviewer",
        "--reason",
        "The installed-binary assurance evidence remains insufficient for acceptance.",
        "--json",
      ],
      `Phase 3 ${definition.id} rejection`,
    );
  }
  if (definition.flow === "stale") {
    await writeFile(candidatePath, `${await readFile(candidatePath, "utf8")}// material drift\n`);
  }
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
    `Phase 3 ${definition.id} Kit action`,
  );
  const kitView = projectActionView(
    parseJson(kitResult, `Phase 3 ${definition.id} Kit action`),
    PHASE_3_COMPATIBILITY_DEFINITION.schemaHash,
  );
  const actions = await collectSurfaceActions({
    context,
    hyper,
    label: `Phase 3 ${definition.id}`,
    taskId: definition.taskId,
  });
  return {
    flow: definition.flow,
    id: definition.id,
    kit: kitView,
    profile: definition.profile,
    surfaces: PHASE_3_COMPATIBILITY_DEFINITION.surfaces.map((id) => ({
      id,
      view: projectActionView(actions.get(id), PHASE_3_COMPATIBILITY_DEFINITION.schemaHash),
    })),
  };
}

async function runCompatibilityJourney({ definition, hyper, kit, root }) {
  const scenario = PHASE_3_COMPATIBILITY_DEFINITION.scenarios[0];
  const context = await createRealProject({ definition: scenario, hyper, kit, root });
  const relativeCandidate = "docs/profile.md";
  await writeFile(
    path.join(context.project, relativeCandidate),
    `${await readFile(path.join(context.project, relativeCandidate), "utf8")}// compatibility\n`,
  );
  await context.runGit(["add", relativeCandidate], `Phase 3 ${definition.id} staging`);
  const actions = await collectSurfaceActions({
    context,
    hyper,
    label: `Phase 3 ${definition.id}`,
    taskId: scenario.taskId,
  });
  return {
    id: definition.id,
    surfaces: PHASE_3_COMPATIBILITY_DEFINITION.surfaces.map((id) => ({
      id,
      view: compatibilityActionView(actions.get(id), definition),
    })),
  };
}

export async function runPackedPhase3Compatibility(input) {
  plain(input, "Phase 3 runner input");
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
    for (const [id, definition] of Object.entries(PHASE_3_COMPATIBILITY_DEFINITION.packages)) {
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
    for (const definition of PHASE_3_COMPATIBILITY_DEFINITION.compatibility) {
      const rowRoot = await createOwnedRoot({ baseDirectory: owned.root });
      compatibility.push(await runCompatibilityJourney({
        definition,
        hyper: packages[definition.hyper],
        kit: packages[definition.kit],
        root: rowRoot.root,
      }));
    }
    const scenarios = [];
    for (const definition of PHASE_3_COMPATIBILITY_DEFINITION.scenarios) {
      const scenarioRoot = await createOwnedRoot({ baseDirectory: owned.root });
      scenarios.push(await runGoldenScenario({
        definition,
        hyper: packages.hyperNew,
        kit: packages.kitNew,
        root: scenarioRoot.root,
      }));
    }
    const report = createPhase3CompatibilityReport({
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
