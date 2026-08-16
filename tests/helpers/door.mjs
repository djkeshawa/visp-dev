/**
 * THE FORGERY, CONFINED TO TESTS.
 *
 * Every scoring entry point refuses any record that did not come out of
 * `openHoldoutForScoring` in this process, save a genuinely scratch one. That is
 * the point of `src/holdout/provenance.mjs`, and it is also inconvenient for a
 * unit test of arithmetic: `scorePack` over an invented fixture is testing a mean, not a
 * spend, and routing it through a temp directory, a manifest, a preregistration
 * and a ledger would test the door instead of the mean.
 *
 * So the tests forge the mark, on purpose, through this one named helper. Two
 * things make that honest rather than a hole:
 *
 *   - it is the SAME function a bypassing script would have to import, so the
 *     residual is demonstrated rather than hidden: an in-process mark cannot
 *     defend against code that deliberately marks records. What it defends
 *     against is a runner that never thought about the rule at all, which is the
 *     failure that actually happened four times;
 *   - `tests/holdout/provenance.test.mjs` asserts that NOTHING outside the
 *     door, the two scoring domains and this file imports
 *     `markScoredThroughDoor` — from the provenance module or from the holdout
 *     barrel. A fifth runner that reaches for this is a failing build, not a
 *     quiet number.
 *
 * The door's own behaviour — that it marks the selection and only the selection,
 * after the ledger entry is written — is tested against the real
 * `openHoldoutForScoring`, never against this.
 */
import { markScoredThroughDoor } from "../../src/holdout/provenance.mjs";

/** Mark fixtures as if the door had returned them. Tests only. */
export function asIfThroughTheDoor(value) {
  return markScoredThroughDoor(value);
}

/** A scored row whose metrics carry the mark `scorePack` would have put there. */
export function scoredRow(row) {
  if (row?.metrics !== undefined && row.metrics !== null) markScoredThroughDoor(row.metrics);
  return row;
}
