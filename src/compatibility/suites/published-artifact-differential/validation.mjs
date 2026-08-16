/**
 * The check this suite exists for is the last one: a report that CLAIMS the
 * corrections were additive while its own two differential rows disagree is
 * refused outright, not recorded as a finding. A stored `identical: false`
 * would be an unread footnote under a headline claim.
 */
import { canonicalStringify } from "../../../platform/canonical-json.mjs";
import { PREFIXED_HASH } from "../../../platform/shape.mjs";
import { exactKeys, exactValue, verifyEnvironment } from "../../engine/shape.mjs";
import {
  verifyPackedPackageRecord,
  verifyRunIdentity,
} from "../../engine/package-record.mjs";
import { assertStableContent, openReport } from "../../engine/report-envelope.mjs";
import {
  PUBLISHED_ARTIFACT_DIFFERENTIAL as SUITE,
  REPORT_NOTE,
} from "./definition.mjs";

const DEFINITION = SUITE.definition;
const DRIFT = "drifted from the frozen published-artifact differential definition";

const REPORT_FIELDS = [
  "compatibility",
  "definitionSha256",
  "differential",
  "environment",
  "note",
  "packages",
  "producer",
  "reportSha256",
  "runIdentity",
  "schemaHash",
  "schemaVersion",
];

const ROW_VIEW_FIELDS = [
  "actionId",
  "actionVerdict",
  "nextCommand",
  "protocolVersion",
  "schemaHash",
  "selectionMode",
];

/**
 * The action views a row observed, keyed by surface, for exact comparison.
 *
 * `actionId` is excluded because it is NOT reproducible between runs — the same
 * packages produce a different id each time, which is why the previous suite
 * removed it from its frozen semantics too. Including it here would make the
 * differential permanently false and prove nothing.
 *
 * Everything an integrator actually depends on is compared: the verdict, the
 * next command, the negotiated protocol, the schema hash and the selection mode.
 */
export function surfaceViews(row) {
  return Object.fromEntries(
    row.surfaces.map((surface) => {
      const { actionId, ...comparable } = surface.view;
      return [surface.id, comparable];
    }),
  );
}

export function differentialIdentical(baselineRow, correctedRow) {
  return canonicalStringify(surfaceViews(baselineRow)) === canonicalStringify(surfaceViews(correctedRow));
}

function verifyCompatibilityRow(row, pinned) {
  const label = `${SUITE.id} compatibility ${pinned.id}`;
  exactKeys(row, ["id", "surfaces"], label);
  if (row.id !== pinned.id
    || !Array.isArray(row.surfaces)
    || row.surfaces.length !== DEFINITION.surfaces.length) {
    throw new Error(`${label} drifted`);
  }
  let rowView;
  row.surfaces.forEach((surface, index) => {
    const surfaceId = DEFINITION.surfaces[index];
    exactKeys(surface, ["id", "view"], `${label} surface`);
    exactKeys(surface.view, ROW_VIEW_FIELDS, `${label}/${surfaceId}`);
    if (surface.id !== surfaceId
      || !PREFIXED_HASH.test(surface.view.actionId)
      || surface.view.protocolVersion !== pinned.expectedProtocol
      || surface.view.schemaHash !== pinned.expectedSchemaHash) {
      throw new Error(`${label}/${surfaceId} drifted`);
    }
    exactValue(
      {
        actionVerdict: surface.view.actionVerdict,
        nextCommand: surface.view.nextCommand,
        selectionMode: surface.view.selectionMode,
      },
      DEFINITION.expectedView,
      `${label}/${surfaceId} semantic observation`,
      DRIFT,
    );
    rowView ??= surface.view;
    exactValue(surface.view, rowView, `${label}/${surfaceId} surface equality`, DRIFT);
  });
}

export function verifyPublishedArtifactDifferentialReport(report) {
  openReport(SUITE, report, REPORT_FIELDS);
  if (report.schemaHash !== DEFINITION.schemaHash || report.note !== REPORT_NOTE) {
    throw new Error(`${SUITE.id} report identity is invalid`);
  }
  if (!["packed-runner", "synthetic-constructor"].includes(report.producer)) {
    throw new Error(`${SUITE.id} report producer is invalid`);
  }
  verifyRunIdentity(report.runIdentity, `${SUITE.id} run identity`);

  exactKeys(report.packages, Object.keys(DEFINITION.packages), `${SUITE.id} packages`);
  for (const [id, pinned] of Object.entries(DEFINITION.packages)) {
    verifyPackedPackageRecord(report.packages[id], pinned, {
      label: `${SUITE.id} package ${id}`,
      drift: DRIFT,
      requirePublishedIdentity: true,
    });
  }

  verifyEnvironment(report.environment, `${SUITE.id} environment`);

  if (!Array.isArray(report.compatibility)
    || report.compatibility.length !== DEFINITION.compatibility.length) {
    throw new Error(`${SUITE.id} report does not contain exactly the frozen compatibility rows`);
  }
  report.compatibility.forEach((row, index) => {
    verifyCompatibilityRow(row, DEFINITION.compatibility[index]);
  });

  exactKeys(report.differential, ["baseline", "corrected", "identical"], `${SUITE.id} differential`);
  exactValue(
    { baseline: report.differential.baseline, corrected: report.differential.corrected },
    DEFINITION.differential,
    `${SUITE.id} differential identity`,
    DRIFT,
  );

  const observedIdentical = differentialIdentical(
    report.compatibility.find((row) => row.id === report.differential.baseline),
    report.compatibility.find((row) => row.id === report.differential.corrected),
  );
  if (report.differential.identical !== observedIdentical) {
    throw new Error(`${SUITE.id} differential result does not match the reported rows`);
  }
  // The whole reason this suite exists. A report claiming the corrections were
  // additive while the differential rows disagree is the failure to catch.
  if (observedIdentical !== true) {
    throw new Error(
      `${SUITE.id} differential failed: the corrected Kit and the previous Kit disagree on a healthy project`,
    );
  }

  assertStableContent(SUITE, report);
  return true;
}
