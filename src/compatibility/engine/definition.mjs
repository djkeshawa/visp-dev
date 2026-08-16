/**
 * A pinned suite: one frozen definition and the digest that identifies it.
 *
 * Every suite's `index.mjs` publishes the same contract around that pin: the
 * pin itself, the report constructor, the verifier, and the packed runner.
 *
 * The digest line `sha256Hex(canonicalStringify(definition))` was written out by
 * hand in five modules. One copy reaching for the compact recipe instead of the
 * pretty one would have produced a different digest for the same definition
 * while every local test still passed, because each suite only ever compared
 * its pin against itself. R1 and R2 both depend on this line being singular.
 *
 * R2: `canonicalStringify` sorts object keys at every depth and leaves ARRAYS in
 * place. Reordering the keys of a definition leaves its digest identical;
 * reordering one array element changes it.
 */
import { canonicalStringify, sha256Hex } from "../../platform/canonical-json.mjs";
import { deepFreeze } from "../../platform/freeze.mjs";

/**
 * @param id          the suite's kebab-case name, used in every failure message
 * @param reportKind  the `schemaVersion` string its reports carry
 * @param definition  the pinned document; frozen here, never after
 */
export function defineSuite({ id, reportKind, definition }) {
  if (typeof id !== "string" || id.length === 0) {
    throw new TypeError("A suite needs a non-empty id");
  }
  if (typeof reportKind !== "string" || reportKind.length === 0) {
    throw new TypeError(`Suite ${id} needs a non-empty reportKind`);
  }
  const frozen = deepFreeze(definition);
  return Object.freeze({
    definition: frozen,
    id,
    reportKind,
    sha256: sha256Hex(canonicalStringify(frozen)),
  });
}
