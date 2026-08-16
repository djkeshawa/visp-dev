/**
 * The `producer` field is not decoration. A report says whether it came from a
 * real packed run or from a synthetic constructor, and only the packed runner
 * can set the former — it holds the module-private token. A test fixture cannot
 * claim to be a packed run, however carefully it is built.
 *
 * R5: this directory imports only `engine/`, `platform/` and `toolchain/`.
 */
import { canonicalStringify } from "../../../platform/canonical-json.mjs";
import { packageIdentityFromPacked, verifyRunIdentity } from "../../engine/package-record.mjs";
import { runPackedSuite } from "../../engine/packed-run.mjs";
import { sealReport } from "../../engine/report-envelope.mjs";
import {
  PUBLISHED_ARTIFACT_DIFFERENTIAL,
  PUBLISHED_ARTIFACT_DIFFERENTIAL_DEFINITION,
  PUBLISHED_ARTIFACT_DIFFERENTIAL_SHA256,
  REPORT_NOTE,
} from "./definition.mjs";
import { runDifferential } from "./journey.mjs";
import {
  differentialIdentical,
  verifyPublishedArtifactDifferentialReport,
} from "./validation.mjs";

export {
  PUBLISHED_ARTIFACT_DIFFERENTIAL,
  PUBLISHED_ARTIFACT_DIFFERENTIAL_DEFINITION,
  PUBLISHED_ARTIFACT_DIFFERENTIAL_SHA256,
  REPORT_NOTE,
  verifyPublishedArtifactDifferentialReport,
};

const DEFINITION = PUBLISHED_ARTIFACT_DIFFERENTIAL_DEFINITION;
const PACKED_RUN_TOKEN = Symbol("packed published-artifact differential run");

export function createPublishedArtifactDifferentialReport(input, producerToken = null) {
  const { baseline, corrected } = DEFINITION.differential;
  const baselineRow = input.compatibility.find((row) => row.id === baseline);
  const correctedRow = input.compatibility.find((row) => row.id === corrected);
  if (baselineRow === undefined || correctedRow === undefined) {
    throw new Error(`${PUBLISHED_ARTIFACT_DIFFERENTIAL.id} requires both differential rows to have run`);
  }

  const report = sealReport(PUBLISHED_ARTIFACT_DIFFERENTIAL, {
    compatibility: input.compatibility,
    differential: {
      baseline,
      corrected,
      // Identical action views on a healthy project is the claim. If this is
      // ever false, the fail-closed correction changed something an integrator
      // running healthy projects can observe, and that is a finding.
      identical: differentialIdentical(baselineRow, correctedRow),
    },
    environment: input.environment,
    note: REPORT_NOTE,
    packages: Object.fromEntries(
      Object.entries(input.packages).map(([id, value]) => [
        id,
        packageIdentityFromPacked(value, `${PUBLISHED_ARTIFACT_DIFFERENTIAL.id} package ${id}`),
      ]),
    ),
    producer: producerToken === PACKED_RUN_TOKEN ? "packed-runner" : "synthetic-constructor",
    runIdentity: structuredClone(input.runIdentity),
    schemaHash: DEFINITION.schemaHash,
  });
  verifyPublishedArtifactDifferentialReport(report);
  return JSON.parse(canonicalStringify(report));
}

export async function runPackedPublishedArtifactDifferential(input) {
  verifyRunIdentity(input?.runIdentity, `${PUBLISHED_ARTIFACT_DIFFERENTIAL.id} run identity`);
  return runPackedSuite({
    suite: PUBLISHED_ARTIFACT_DIFFERENTIAL,
    input,
    packages: DEFINITION.packages,
    journey: runDifferential,
    create: (body) => createPublishedArtifactDifferentialReport(
      { ...body, runIdentity: input.runIdentity },
      PACKED_RUN_TOKEN,
    ),
  });
}
