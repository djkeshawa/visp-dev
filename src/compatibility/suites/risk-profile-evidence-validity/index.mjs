/** R5: this directory imports only `engine/`, `platform/` and `toolchain/`. */
import { canonicalStringify } from "../../../platform/canonical-json.mjs";
import { createOwnedRoot } from "../../../toolchain/index.mjs";
import { plainObject } from "../../../platform/shape.mjs";
import { sealReport } from "../../engine/report-envelope.mjs";
import { runPackedSuite } from "../../engine/packed-run.mjs";
import {
  PREFIXED_SCHEMA_HASH,
  RISK_PROFILE_EVIDENCE_VALIDITY,
  RISK_PROFILE_EVIDENCE_VALIDITY_DEFINITION,
  RISK_PROFILE_EVIDENCE_VALIDITY_SHA256,
} from "./definition.mjs";
import { runProfileScenario } from "./journey.mjs";
import { verifyRiskProfileEvidenceValidityReport } from "./validation.mjs";

export {
  RISK_PROFILE_EVIDENCE_VALIDITY,
  RISK_PROFILE_EVIDENCE_VALIDITY_DEFINITION,
  RISK_PROFILE_EVIDENCE_VALIDITY_SHA256,
  verifyRiskProfileEvidenceValidityReport,
};

const DEFINITION = RISK_PROFILE_EVIDENCE_VALIDITY_DEFINITION;

export function createRiskProfileEvidenceValidityReport(input) {
  plainObject(input, `${RISK_PROFILE_EVIDENCE_VALIDITY.id} report input`);
  const report = sealReport(RISK_PROFILE_EVIDENCE_VALIDITY, {
    environment: structuredClone(input.environment),
    packages: structuredClone(input.packages),
    pair: structuredClone(DEFINITION.pair),
    profiles: structuredClone(input.profiles),
    schemaHash: PREFIXED_SCHEMA_HASH,
    summary: {
      profilesPassed: input.profiles.length,
      surfacesPassed: input.profiles.reduce((count, profile) => count + profile.surfaces.length, 0),
      testsPassed: true,
    },
  });
  verifyRiskProfileEvidenceValidityReport(report);
  return JSON.parse(canonicalStringify(report));
}

export async function runPackedRiskProfileEvidenceValidity(input) {
  return runPackedSuite({
    suite: RISK_PROFILE_EVIDENCE_VALIDITY,
    input,
    packages: DEFINITION.pair,
    create: createRiskProfileEvidenceValidityReport,
    journey: async ({ ownedRoot, packages }) => {
      const profiles = [];
      for (const definition of DEFINITION.profiles) {
        const profileRoot = await createOwnedRoot({ baseDirectory: ownedRoot });
        profiles.push(await runProfileScenario({
          definition,
          hyper: packages.hyper,
          kit: packages.kit,
          root: profileRoot.root,
        }));
      }
      return { profiles };
    },
  });
}
