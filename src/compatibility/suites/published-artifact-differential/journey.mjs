/**
 * Three compatibility rows over the published pair and the pair it superseded.
 *
 * There are no golden scenarios here on purpose. The claim is a DIFFERENTIAL —
 * two rows that must agree — and adding scenario coverage would broaden the
 * document beyond what the two rows actually establish.
 */
import { createOwnedRoot } from "../../../toolchain/index.mjs";
import { runPairCompatibilityJourney } from "../../engine/surface-journey.mjs";
import { PUBLISHED_ARTIFACT_DIFFERENTIAL as SUITE } from "./definition.mjs";

const DEFINITION = SUITE.definition;

export async function runDifferential({ ownedRoot, packages }) {
  const compatibility = [];
  for (const definition of DEFINITION.compatibility) {
    const rowRoot = await createOwnedRoot({ baseDirectory: ownedRoot });
    compatibility.push(await runPairCompatibilityJourney({
      definition,
      hyper: packages[definition.hyper],
      kit: packages[definition.kit],
      label: SUITE.id,
      root: rowRoot.root,
      scenario: DEFINITION.scenario,
      surfaces: DEFINITION.surfaces,
    }));
  }
  return { compatibility };
}
