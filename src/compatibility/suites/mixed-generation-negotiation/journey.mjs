/**
 * The two measurements this suite makes, each bound to its own pinned pairing.
 *
 * The compatibility rows install one generation of Kit against another of
 * Hyper; the golden scenarios always use the newest pair, because their subject
 * is review flow rather than negotiation.
 */
import { createOwnedRoot } from "../../../toolchain/index.mjs";
import {
  runAssuranceScenario,
  runPairCompatibilityJourney,
} from "../../engine/surface-journey.mjs";
import { MIXED_GENERATION_NEGOTIATION as SUITE } from "./definition.mjs";

const DEFINITION = SUITE.definition;
const REVIEWER = "mixed-generation-compatibility-reviewer";

export async function runNegotiation({ ownedRoot, packages }) {
  const compatibility = [];
  for (const definition of DEFINITION.compatibility) {
    const rowRoot = await createOwnedRoot({ baseDirectory: ownedRoot });
    compatibility.push(await runPairCompatibilityJourney({
      definition,
      hyper: packages[definition.hyper],
      kit: packages[definition.kit],
      label: SUITE.id,
      root: rowRoot.root,
      // Row journeys reuse the first golden scenario's project shape; they
      // measure negotiation, not the review flow that scenario describes.
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
