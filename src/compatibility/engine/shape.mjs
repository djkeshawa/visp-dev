/**
 * The closed-shape guards, plus the ones only compatibility evidence needs.
 *
 * Everything generic is re-exported from `src/platform/shape.mjs` rather than
 * copied, so a suite has exactly one import for shape checking and no reason to
 * reach past this module.
 */
export {
  COMMIT,
  HASH,
  PREFIXED_HASH,
  exactArray,
  exactKeys,
  exactValue,
  plainObject,
  verifyCommit,
  verifyHash,
} from "../../platform/shape.mjs";

import path from "node:path";

import { PREFIXED_HASH, exactKeys, exactValue } from "../../platform/shape.mjs";
import { validateHotspots } from "./surface-journey.mjs";

/** The exact environment fields every pinned suite report carries. */
export const ENVIRONMENT_FIELDS = [
  "architecture",
  "git",
  "node",
  "npm",
  "operatingSystem",
  "pnpm",
];

/**
 * A binding to a file inside the project under test.
 *
 * Absolute paths and `..` are refused because a binding is evidence about the
 * fixture, and one naming a location outside it describes something the run
 * never controlled.
 */
export function verifyArtifactBinding(artifact, label) {
  exactKeys(artifact, ["path", "sha256"], label);
  if (typeof artifact.path !== "string"
    || path.isAbsolute(artifact.path)
    || artifact.path.includes("..")
    || !PREFIXED_HASH.test(artifact.sha256)) {
    throw new Error(`${label} is not a stable project-relative artifact binding`);
  }
  return true;
}

/** Every environment field present and non-empty; an empty one proves nothing. */
export function verifyEnvironment(environment, label) {
  exactKeys(environment, ENVIRONMENT_FIELDS, label);
  if (Object.values(environment).some(
    (value) => typeof value !== "string" || value.length === 0,
  )) {
    throw new Error(`${label} is incomplete`);
  }
  return true;
}

/**
 * A recorded human decision about an assurance case.
 *
 * A `current`, `rejected` or `stale` decision must carry the hash of the case it
 * was made about; `missing` must not. Without that binding a decision could be
 * carried forward onto a case nobody looked at, which is precisely what the
 * `stale` scenario exists to expose.
 */
export function verifyReviewDecision(value, definition, label) {
  exactKeys(value, ["decisionHash", "reason", "required", "status"], label);
  if (typeof value.required !== "boolean"
    || value.status !== definition.reviewStatus
    || typeof value.reason !== "string"
    || value.reason.length === 0) {
    throw new Error(`${label} drifted from Kit's expected golden observation`);
  }
  const expectsHash = ["current", "rejected", "stale"].includes(definition.reviewStatus);
  if (expectsHash ? !PREFIXED_HASH.test(value.decisionHash ?? "") : value.decisionHash !== null) {
    throw new Error(`${label} decision hash is inconsistent with the observed status`);
  }
  return true;
}

const ACTION_VIEW_FIELDS = [
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
];
const VERDICTS = ["ready", "blocked", "inconclusive"];

/**
 * One projected WorkflowAction 3.2 view, against the scenario that produced it
 * and against the semantics the suite froze.
 *
 * The last four `exactValue` calls are what stop a partial rewrite: the view's
 * top-level verdict, case hash, review decision and hotspots must still equal
 * the ones inside the summary they were lifted from, so editing one copy and
 * rehashing cannot make a report self-consistent.
 */
export function verifyAssuranceActionView({ view, definition, label, schemaHash, observation, drift }) {
  exactKeys(view, ACTION_VIEW_FIELDS, label);
  if (!PREFIXED_HASH.test(view.actionId)
    || view.protocolVersion !== "3.2"
    || view.schemaHash !== schemaHash
    || !VERDICTS.includes(view.actionVerdict)
    || typeof view.nextCommand !== "string"
    || view.nextCommand.length === 0) {
    throw new Error(`${label} action identity or exact next command is invalid`);
  }

  const summary = view.assuranceSummary;
  exactKeys(
    summary,
    ["artifact", "caseHash", "mandatoryHotspots", "reviewDecision", "state", "verdict", "version"],
    `${label} assurance summary`,
  );
  if (summary.state !== definition.summaryState
    || summary.state !== "available"
    || summary.version !== "1.0"
    || !PREFIXED_HASH.test(summary.caseHash ?? "")
    || !PREFIXED_HASH.test(summary.artifact?.contentHash ?? "")
    || typeof summary.artifact?.path !== "string"
    || summary.artifact.path.includes("..")
    || summary.verdict !== definition.assuranceVerdict) {
    throw new Error(`${label} assurance summary drifted from Kit's golden observation`);
  }
  verifyReviewDecision(summary.reviewDecision, definition, `${label} assurance review decision`);
  validateHotspots(summary.mandatoryHotspots, `${label} mandatory hotspots`);

  exactValue(
    {
      actionVerdict: view.actionVerdict,
      hotspots: summary.mandatoryHotspots.map(({ id, category }) => [id, category]),
      nextCommand: view.nextCommand,
      reviewRequired: summary.reviewDecision.required,
    },
    observation,
    `${label} frozen semantic observation`,
    drift,
  );
  exactValue(view.caseHash, summary.caseHash, `${label} case hash`, drift);
  exactValue(view.assuranceVerdict, summary.verdict, `${label} assurance verdict`, drift);
  exactValue(view.reviewDecision, summary.reviewDecision, `${label} review decision`, drift);
  exactValue(view.mandatoryHotspots, summary.mandatoryHotspots, `${label} mandatory hotspots`, drift);
  return true;
}
