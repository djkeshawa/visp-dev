/**
 * Two claims are checked, and they fail in different ways. A compatibility row
 * fails if the six surfaces disagree with each other about the negotiated
 * protocol. A golden scenario fails if any surface disagrees with KIT — which
 * is stricter, because Kit is the authority and Hyper only presents.
 */
import {
  exactKeys,
  exactValue,
  verifyAssuranceActionView,
  verifyEnvironment,
} from "../../engine/shape.mjs";
import { PREFIXED_HASH } from "../../../platform/shape.mjs";
import { verifyPackedPackageRecord } from "../../engine/package-record.mjs";
import { assertStableContent, openReport } from "../../engine/report-envelope.mjs";
import {
  MIXED_GENERATION_NEGOTIATION as SUITE,
  MIXED_GENERATION_OBSERVATIONS as OBSERVED,
} from "./definition.mjs";

const DEFINITION = SUITE.definition;
const DRIFT = "drifted from the mixed-generation negotiation definition";
const VERDICTS = ["ready", "blocked", "inconclusive"];

const REPORT_FIELDS = [
  "compatibility",
  "definitionSha256",
  "environment",
  "packages",
  "reportSha256",
  "scenarios",
  "schemaHash",
  "schemaVersion",
  "summary",
];

const ROW_VIEW_FIELDS = [
  "actionId",
  "actionVerdict",
  "nextCommand",
  "protocolVersion",
  "schemaHash",
  "selectionMode",
];

function verifyPackage(record, id) {
  const kit = id.startsWith("kit");
  verifyPackedPackageRecord(record, DEFINITION.packages[id], {
    label: `${SUITE.id} package ${id}`,
    packageName: kit ? "visp-kit" : "visp-hyper-agent",
    binName: kit ? "visp" : "visp-hyper",
    expectedTarballSha256: OBSERVED.packages[id],
    drift: DRIFT,
  });
}

function verifyCompatibilityRow(row, definition) {
  const label = `${SUITE.id} compatibility ${definition.id}`;
  exactKeys(row, ["id", "surfaces"], label);
  if (row.id !== definition.id
    || !Array.isArray(row.surfaces)
    || row.surfaces.length !== DEFINITION.surfaces.length) {
    throw new Error(`${label} drifted`);
  }
  let expectedView;
  row.surfaces.forEach((surface, index) => {
    const surfaceId = DEFINITION.surfaces[index];
    exactKeys(surface, ["id", "view"], `${label} surface`);
    exactKeys(surface.view, ROW_VIEW_FIELDS, `${label} ${surfaceId}`);
    if (surface.id !== surfaceId
      || surface.view.protocolVersion !== definition.expectedProtocol
      || surface.view.schemaHash !== definition.expectedSchemaHash
      || surface.view.selectionMode !== "advertised"
      || !PREFIXED_HASH.test(surface.view.actionId)
      || !VERDICTS.includes(surface.view.actionVerdict)
      || typeof surface.view.nextCommand !== "string"
      || surface.view.nextCommand.length === 0) {
      throw new Error(`${label} ${surfaceId} drifted`);
    }
    exactValue(
      {
        actionId: surface.view.actionId,
        actionVerdict: surface.view.actionVerdict,
        nextCommand: surface.view.nextCommand,
      },
      OBSERVED.compatibility[definition.id],
      `${label} ${surfaceId} frozen semantic observation`,
      DRIFT,
    );
    expectedView ??= surface.view;
    exactValue(surface.view, expectedView, `${label} ${surfaceId} equality`, DRIFT);
  });
}

function verifyScenario(scenario, definition) {
  const label = `${SUITE.id} ${definition.id}`;
  exactKeys(scenario, ["flow", "id", "kit", "profile", "surfaces"], label);
  if (scenario.id !== definition.id
    || scenario.flow !== definition.flow
    || scenario.profile !== definition.profile) {
    throw new Error(`${label} identity drifted`);
  }
  const view = (candidate, viewLabel) => verifyAssuranceActionView({
    definition,
    drift: DRIFT,
    label: viewLabel,
    observation: OBSERVED.scenarios[definition.id],
    schemaHash: DEFINITION.schemaHash,
    view: candidate,
  });
  view(scenario.kit, `${label} Kit action`);

  if (!Array.isArray(scenario.surfaces)
    || scenario.surfaces.length !== DEFINITION.surfaces.length) {
    throw new Error(`${label} must contain exactly six surfaces`);
  }
  scenario.surfaces.forEach((surface, index) => {
    const expectedId = DEFINITION.surfaces[index];
    exactKeys(surface, ["id", "view"], `${label} surface`);
    if (surface.id !== expectedId) throw new Error(`${label} surface order drifted`);
    view(surface.view, `${label} ${expectedId}`);
    exactValue(surface.view, scenario.kit, `${label} ${expectedId} equality`, DRIFT);
  });
}

export function verifyMixedGenerationNegotiationReport(report) {
  openReport(SUITE, report, REPORT_FIELDS);
  if (report.schemaHash !== DEFINITION.schemaHash) {
    throw new Error(`${SUITE.id} report identity is invalid`);
  }

  exactKeys(report.packages, Object.keys(DEFINITION.packages), `${SUITE.id} packages`);
  for (const id of Object.keys(DEFINITION.packages)) verifyPackage(report.packages[id], id);

  verifyEnvironment(report.environment, `${SUITE.id} environment`);

  if (!Array.isArray(report.compatibility)
    || report.compatibility.length !== DEFINITION.compatibility.length) {
    throw new Error(`${SUITE.id} report must contain exactly three compatibility rows`);
  }
  report.compatibility.forEach((row, index) => {
    verifyCompatibilityRow(row, DEFINITION.compatibility[index]);
  });

  if (!Array.isArray(report.scenarios)
    || report.scenarios.length !== DEFINITION.scenarios.length) {
    throw new Error(`${SUITE.id} report must contain exactly four golden scenarios`);
  }
  report.scenarios.forEach((scenario, index) => {
    verifyScenario(scenario, DEFINITION.scenarios[index]);
  });

  exactValue(report.summary, {
    compatibilityRowsPassed: 3,
    scenariosPassed: 4,
    surfacesPassed: 24,
    testsPassed: true,
  }, `${SUITE.id} summary`, DRIFT);

  assertStableContent(SUITE, report);
  return true;
}
