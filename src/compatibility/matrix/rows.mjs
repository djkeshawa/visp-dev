/**
 * The frozen exact-pair matrix: five positive rows and seven negative cases.
 *
 * A row is a claim about TWO EXACT COMMITS, never about a version range. The
 * negative corpus is bounded and declared for the same reason the positive rows
 * are: "we reject bad input" is not a claim until the exact rejections are
 * named, and a corpus derived from whatever happened to fail cannot report a
 * hole.
 */
import { canonicalStringify, sha256Hex } from "../../platform/canonical-json.mjs";
import { deepFreeze } from "../../platform/freeze.mjs";

/** The six canonical surfaces the last row proves agree byte for byte. */
export const POSITIVE_SURFACES = ["run", "next", "resume", "checkpoint", "guard", "mcp"];

export const COMPATIBILITY_MATRIX_ROWS = deepFreeze([
  {
    id: "A",
    kit: {
      commit: "0a8026ca129cdb9ec8ba516a2e30aaf135d5d4a0",
      tree: "7512dd5187b88708c98def54ee94b1b774de61d9",
    },
    hyper: {
      commit: "d4444da8f862dc229f6832c6bc89820df466d213",
      tree: "c548560bb0feecea5dc2032ec5b5ac5791ea9ab3",
    },
    expectedProtocol: "2.0",
    selection: "selectorless_default",
    scenarios: ["kit_selectorless_v2", "hyper_selectorless_v2", "no_protocol_advertisement"],
    canonicalSurfaces: null,
  },
  {
    id: "B",
    kit: {
      commit: "c03a2dd0838501f4c4e480a69171848d3f2c0499",
      tree: "c32f84f58eda4d5efde702e424d6e2b6406144f5",
    },
    hyper: {
      commit: "d4444da8f862dc229f6832c6bc89820df466d213",
      tree: "c548560bb0feecea5dc2032ec5b5ac5791ea9ab3",
    },
    expectedProtocol: "2.0",
    selection: "selectorless_default",
    scenarios: ["kit_selectorless_v2", "kit_explicit_v3", "hyper_selectorless_v2"],
    canonicalSurfaces: null,
  },
  {
    id: "C",
    kit: {
      commit: "706c1ec348b9de8a51651d1c8e9587feb1962fd8",
      tree: "7228012509bd4c165f30c9460fd235f1cdbadfbb",
    },
    hyper: {
      commit: "d4444da8f862dc229f6832c6bc89820df466d213",
      tree: "c548560bb0feecea5dc2032ec5b5ac5791ea9ab3",
    },
    expectedProtocol: "2.0",
    selection: "selectorless_default",
    scenarios: ["kit_advertises_v2_v3", "hyper_selectorless_v2", "advertisement_tolerated"],
    canonicalSurfaces: null,
  },
  {
    id: "D",
    kit: {
      commit: "706c1ec348b9de8a51651d1c8e9587feb1962fd8",
      tree: "7228012509bd4c165f30c9460fd235f1cdbadfbb",
    },
    hyper: {
      commit: "17f01e4295258ec55c4c74cb47dcfdbb66981dce",
      tree: "52c098d4d52c8d2c23fe17a34c671d42048f1117",
    },
    expectedProtocol: "3.0",
    selection: "advertised_auto",
    scenarios: ["doctor_negotiated_v3", "historical_strict_next_v2"],
    canonicalSurfaces: null,
  },
  {
    id: "E",
    kit: {
      commit: "d85adbdac5dac85bea112c857967c067cb1708a9",
      tree: "cb12729f54d1ff2fbcc818bb4c487691983cfa6a",
    },
    hyper: {
      commit: "2bf636f58517780256cd91089440fb3b2f501480",
      tree: "0080f3e351372a5f8b40864dd6653ee2a1e4e88e",
    },
    expectedProtocol: "3.0",
    selection: "advertised_auto",
    scenarios: [
      "kit_selectorless_legacy_v2",
      "kit_explicit_v2",
      "hyper_auto_v3",
      "surface_run",
      "surface_next",
      "surface_resume",
      "surface_checkpoint",
      "surface_guard",
      "surface_mcp",
    ],
    canonicalSurfaces: POSITIVE_SURFACES,
  },
]);

/**
 * Input the pair must refuse, and the EXACT reason code each refusal carries.
 *
 * Pinning the reason code is what separates "it exited non-zero" from "it
 * refused for the reason we claim": a crash and a considered rejection both
 * exit 1.
 */
export const DELIBERATELY_UNSUPPORTED_CASES = deepFreeze([
  {
    id: "future_protocol_rejected",
    category: "future_protocol",
    reasonCode: "workflow_action_no_mutual_protocol",
  },
  {
    id: "malformed_advertisement_rejected",
    category: "malformed_advertisement",
    reasonCode: "workflow_action_advertisement_invalid",
  },
  {
    id: "schema_hash_mismatch_rejected",
    category: "schema_hash_mismatch",
    reasonCode: "workflow_action_schema_hash_mismatch",
  },
  {
    id: "malformed_action_rejected",
    category: "malformed_action",
    reasonCode: "workflow_action_schema_invalid",
  },
  {
    id: "wrong_returned_protocol_rejected",
    category: "wrong_returned_protocol",
    reasonCode: "workflow_action_protocol_mismatch",
  },
  {
    id: "semantic_contradiction_rejected",
    category: "semantic_contradiction",
    reasonCode: "workflow_action_contradiction",
  },
  {
    id: "explicit_unsupported_request_rejected",
    category: "explicit_unsupported_request",
    reasonCode: "UNSUPPORTED_WORKFLOW_ACTION_PROTOCOL",
  },
]);

export const COMPATIBILITY_MATRIX_SHA256 = sha256Hex(canonicalStringify({
  deliberatelyUnsupported: DELIBERATELY_UNSUPPORTED_CASES,
  rows: COMPATIBILITY_MATRIX_ROWS,
}));

/**
 * One row, or all of them. A comma-separated list is refused deliberately: a
 * debug rerun that quietly broadened its own scope would produce a partial
 * document indistinguishable from a full one.
 */
export function selectCompatibilityMatrixRows(row = null) {
  if (row === null) return COMPATIBILITY_MATRIX_ROWS;
  if (typeof row !== "string" || !/^[A-E]$/u.test(row)) {
    throw new TypeError("row must be one exact matrix row ID from A through E");
  }
  return COMPATIBILITY_MATRIX_ROWS.filter(({ id }) => id === row);
}
