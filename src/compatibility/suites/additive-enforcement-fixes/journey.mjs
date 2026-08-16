/**
 * The two measurements this suite makes, against the corrected pair.
 */
import { createOwnedRoot } from "../../../toolchain/index.mjs";
import {
  runAssuranceScenario,
  runPairCompatibilityJourney,
} from "../../engine/surface-journey.mjs";
import { ADDITIVE_ENFORCEMENT_FIXES as SUITE } from "./definition.mjs";

const DEFINITION = SUITE.definition;
const REVIEWER = "additive-fixes-compatibility-reviewer";

export async function runEnforcementFixes({ ownedRoot, packages }) {
  const compatibility = [];
  for (const definition of DEFINITION.compatibility) {
    const rowRoot = await createOwnedRoot({ baseDirectory: ownedRoot });
    compatibility.push(await runPairCompatibilityJourney({
      definition,
      hyper: packages[definition.hyper],
      kit: packages[definition.kit],
      label: SUITE.id,
      root: rowRoot.root,
      scenario: DEFINITION.scenarios[0],
      surfaces: DEFINITION.surfaces,
    }));
  }

  const scenarios = [];
  for (const definition of DEFINITION.scenarios) {
    const scenarioRoot = await createOwnedRoot({ baseDirectory: ownedRoot });
    scenarios.push(await runAssuranceScenario({
      definition,
      hyper: packages.hyperNew,
      kit: packages.kitNew,
      label: `${SUITE.id} ${definition.id}`,
      reviewer: REVIEWER,
      root: scenarioRoot.root,
      schemaHash: DEFINITION.schemaHash,
      surfaces: DEFINITION.surfaces,
    }));
  }

  return { compatibility, scenarios };
}
