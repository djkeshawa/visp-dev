/** R5: this directory imports only `engine/`, `platform/` and `toolchain/`. */
import { canonicalStringify } from "../../../platform/canonical-json.mjs";
import { plainObject } from "../../../platform/shape.mjs";
import { runPackedSuite } from "../../engine/packed-run.mjs";
import { sealReport } from "../../engine/report-envelope.mjs";
import {
  ADDITIVE_ENFORCEMENT_FIXES,
  ADDITIVE_ENFORCEMENT_FIXES_DEFINITION,
  ADDITIVE_ENFORCEMENT_FIXES_SHA256,
  ADDITIVE_ENFORCEMENT_OBSERVATIONS,
} from "./definition.mjs";
import { runEnforcementFixes } from "./journey.mjs";
import { verifyAdditiveEnforcementFixesReport } from "./validation.mjs";

export {
  ADDITIVE_ENFORCEMENT_FIXES,
  ADDITIVE_ENFORCEMENT_FIXES_DEFINITION,
  ADDITIVE_ENFORCEMENT_FIXES_SHA256,
  ADDITIVE_ENFORCEMENT_OBSERVATIONS,
  verifyAdditiveEnforcementFixesReport,
};

export function createAdditiveEnforcementFixesReport(input) {
  plainObject(input, `${ADDITIVE_ENFORCEMENT_FIXES.id} report input`);
  const report = sealReport(ADDITIVE_ENFORCEMENT_FIXES, {
    compatibility: structuredClone(input.compatibility),
    environment: structuredClone(input.environment),
    packages: structuredClone(input.packages),
    scenarios: structuredClone(input.scenarios),
    schemaHash: ADDITIVE_ENFORCEMENT_FIXES_DEFINITION.schemaHash,
    summary: {
      compatibilityRowsPassed: input.compatibility.length,
      scenariosPassed: input.scenarios.length,
      surfacesPassed: input.scenarios.reduce(
        (count, scenario) => count + scenario.surfaces.length,
        0,
      ),
      testsPassed: true,
    },
  });
  verifyAdditiveEnforcementFixesReport(report);
  return JSON.parse(canonicalStringify(report));
}

export async function runPackedAdditiveEnforcementFixes(input) {
  return runPackedSuite({
    suite: ADDITIVE_ENFORCEMENT_FIXES,
    input,
    packages: ADDITIVE_ENFORCEMENT_FIXES_DEFINITION.packages,
    create: createAdditiveEnforcementFixesReport,
    journey: runEnforcementFixes,
  });
}

/**
 * The freezable observations, derived from a completed report.
 *
 * This is how a re-pin is done honestly: run the suite, read the observations
 * out of the report it produced, and paste them into the definition — rather
 * than editing a constant until the run stops failing.
 */
export function observedAdditiveEnforcementSemantics(report) {
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
