/** R5: this directory imports only `engine/`, `platform/` and `toolchain/`. */
import { canonicalStringify } from "../../../platform/canonical-json.mjs";
import { plainObject } from "../../../platform/shape.mjs";
import { runPackedSuite } from "../../engine/packed-run.mjs";
import { sealReport } from "../../engine/report-envelope.mjs";
import {
  MIXED_GENERATION_NEGOTIATION,
  MIXED_GENERATION_NEGOTIATION_DEFINITION,
  MIXED_GENERATION_NEGOTIATION_SHA256,
  MIXED_GENERATION_OBSERVATIONS,
} from "./definition.mjs";
import { runNegotiation } from "./journey.mjs";
import { verifyMixedGenerationNegotiationReport } from "./validation.mjs";

export {
  MIXED_GENERATION_NEGOTIATION,
  MIXED_GENERATION_NEGOTIATION_DEFINITION,
  MIXED_GENERATION_NEGOTIATION_SHA256,
  MIXED_GENERATION_OBSERVATIONS,
  verifyMixedGenerationNegotiationReport,
};

export function createMixedGenerationNegotiationReport(input) {
  plainObject(input, `${MIXED_GENERATION_NEGOTIATION.id} report input`);
  const report = sealReport(MIXED_GENERATION_NEGOTIATION, {
    compatibility: structuredClone(input.compatibility),
    environment: structuredClone(input.environment),
    packages: structuredClone(input.packages),
    scenarios: structuredClone(input.scenarios),
    schemaHash: MIXED_GENERATION_NEGOTIATION_DEFINITION.schemaHash,
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
  verifyMixedGenerationNegotiationReport(report);
  return JSON.parse(canonicalStringify(report));
}

export async function runPackedMixedGenerationNegotiation(input) {
  return runPackedSuite({
    suite: MIXED_GENERATION_NEGOTIATION,
    input,
    packages: MIXED_GENERATION_NEGOTIATION_DEFINITION.packages,
    create: createMixedGenerationNegotiationReport,
    journey: runNegotiation,
  });
}
