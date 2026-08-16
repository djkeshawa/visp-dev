/**
 * The load-bearing assertion is the last one in `verifyProfile`: every surface's
 * evidence must be DEEP-EQUAL to the Kit action's evidence, not merely
 * well-formed. A surface that dropped a provider and still reported "passed"
 * would satisfy every shape check individually.
 */
import {
  exactKeys,
  exactValue,
  verifyArtifactBinding,
  verifyEnvironment,
} from "../../engine/shape.mjs";
import { verifyPackedPackageRecord } from "../../engine/package-record.mjs";
import { PREFIXED_HASH } from "../../../platform/shape.mjs";
import { assertStableContent, openReport } from "../../engine/report-envelope.mjs";
import {
  PREFIXED_SCHEMA_HASH,
  PROTOCOL_VERSION,
  RISK_PROFILE_EVIDENCE_VALIDITY as SUITE,
} from "./definition.mjs";

const DEFINITION = SUITE.definition;
const DRIFT = "drifted from the risk-profile evidence-validity definition";

const REPORT_FIELDS = [
  "definitionSha256",
  "environment",
  "packages",
  "pair",
  "profiles",
  "reportSha256",
  "schemaHash",
  "schemaVersion",
  "summary",
];

/**
 * Fresh, passed, candidate-sourced evidence with at least one provider result
 * carrying the independence the profile demands.
 *
 * "At least one" rather than "all": Kit legitimately reports several providers
 * with mixed independence, and requiring all of them would fail an honest run.
 */
function verifyEvidence(evidence, definition, label) {
  exactKeys(evidence, ["freshness", "outcome", "providers", "source"], label);
  if (evidence.source !== "candidate"
    || evidence.outcome !== "passed"
    || evidence.freshness !== "fresh"
    || !Array.isArray(evidence.providers)
    || evidence.providers.length === 0) {
    throw new Error(`${label} does not prove fresh passed candidate evidence`);
  }
  let independentPass = false;
  for (const provider of evidence.providers) {
    exactKeys(provider, ["results", "status"], `${label} provider`);
    if (provider.status !== "passed"
      || !Array.isArray(provider.results)
      || provider.results.length === 0) {
      throw new Error(`${label} provider did not pass`);
    }
    for (const result of provider.results) {
      exactKeys(result, ["freshness", "independence", "status"], `${label} provider result`);
      if (result.status !== "passed" || result.freshness !== "fresh") {
        throw new Error(`${label} provider result is not a fresh pass`);
      }
      if (result.independence === definition.testIndependence) independentPass = true;
    }
  }
  if (!independentPass) throw new Error(`${label} lacks the required test independence`);
}

function verifyActionIdentity(view, definition, label) {
  if (view.profile !== definition.profile
    || view.protocolVersion !== PROTOCOL_VERSION
    || view.schemaHash !== PREFIXED_SCHEMA_HASH
    || !PREFIXED_HASH.test(view.actionId)) {
    throw new Error(`${label} identity drifted`);
  }
}

function verifyProfile(record, definition) {
  const label = `risk profile ${definition.profile}`;
  exactKeys(
    record,
    ["artifacts", "humanApproval", "id", "kit", "profile", "surfaces", "taskId"],
    label,
  );
  if (record.id !== definition.id
    || record.profile !== definition.profile
    || record.taskId !== definition.taskId
    || record.humanApproval !== definition.humanApproval) {
    throw new Error(`${label} identity drifted`);
  }

  exactKeys(record.artifacts, ["baseline", "candidate", "lock", "plan"], `${label} artifacts`);
  for (const [kind, artifact] of Object.entries(record.artifacts)) {
    verifyArtifactBinding(artifact, `${label} ${kind}`);
  }

  exactKeys(
    record.kit,
    ["actionId", "evidence", "profile", "protocolVersion", "schemaHash"],
    `${label} Kit action`,
  );
  verifyActionIdentity(record.kit, definition, `${label} Kit action`);
  verifyEvidence(record.kit.evidence, definition, `${label} Kit evidence`);

  if (!Array.isArray(record.surfaces)
    || record.surfaces.length !== DEFINITION.surfaces.length) {
    throw new Error(`${label} must contain exactly six surfaces`);
  }
  DEFINITION.surfaces.forEach((expectedSurface, index) => {
    const surface = record.surfaces[index];
    const surfaceLabel = `${label} surface ${expectedSurface}`;
    exactKeys(
      surface,
      ["actionId", "evidence", "id", "profile", "protocolVersion", "schemaHash"],
      surfaceLabel,
    );
    verifyActionIdentity(surface, definition, surfaceLabel);
    if (surface.id !== expectedSurface || surface.actionId !== record.kit.actionId) {
      throw new Error(`${surfaceLabel} identity drifted`);
    }
    exactValue(surface.evidence, record.kit.evidence, `${surfaceLabel} evidence`, DRIFT);
    verifyEvidence(surface.evidence, definition, `${surfaceLabel} evidence`);
  });
}

export function verifyRiskProfileEvidenceValidityReport(report) {
  openReport(SUITE, report, REPORT_FIELDS);
  if (report.schemaHash !== PREFIXED_SCHEMA_HASH) {
    throw new Error(`${SUITE.id} report identity is invalid`);
  }
  exactValue(report.pair, DEFINITION.pair, `${SUITE.id} pair`, DRIFT);

  exactKeys(report.packages, ["hyper", "kit"], `${SUITE.id} packages`);
  verifyPackedPackageRecord(report.packages.kit, DEFINITION.pair.kit, {
    label: `${SUITE.id} kit package`,
    packageName: "visp-kit",
    binName: "visp",
    drift: DRIFT,
  });
  verifyPackedPackageRecord(report.packages.hyper, DEFINITION.pair.hyper, {
    label: `${SUITE.id} hyper package`,
    packageName: "visp-hyper-agent",
    binName: "visp-hyper",
    drift: DRIFT,
  });

  verifyEnvironment(report.environment, `${SUITE.id} environment`);

  if (!Array.isArray(report.profiles) || report.profiles.length !== DEFINITION.profiles.length) {
    throw new Error(`${SUITE.id} report must contain exactly three profiles`);
  }
  report.profiles.forEach((profile, index) => verifyProfile(profile, DEFINITION.profiles[index]));

  exactValue(report.summary, {
    profilesPassed: 3,
    surfacesPassed: 18,
    testsPassed: true,
  }, `${SUITE.id} summary`, DRIFT);

  assertStableContent(SUITE, report);
  return true;
}
