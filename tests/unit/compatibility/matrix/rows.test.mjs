import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPATIBILITY_MATRIX_ROWS,
  COMPATIBILITY_MATRIX_SHA256,
  DELIBERATELY_UNSUPPORTED_CASES,
  selectCompatibilityMatrixRows,
} from "../../../../src/compatibility/matrix/rows.mjs";

const exactPairs = [
  ["0a8026ca129cdb9ec8ba516a2e30aaf135d5d4a0", "d4444da8f862dc229f6832c6bc89820df466d213"],
  ["c03a2dd0838501f4c4e480a69171848d3f2c0499", "d4444da8f862dc229f6832c6bc89820df466d213"],
  ["706c1ec348b9de8a51651d1c8e9587feb1962fd8", "d4444da8f862dc229f6832c6bc89820df466d213"],
  ["706c1ec348b9de8a51651d1c8e9587feb1962fd8", "17f01e4295258ec55c4c74cb47dcfdbb66981dce"],
  ["d85adbdac5dac85bea112c857967c067cb1708a9", "2bf636f58517780256cd91089440fb3b2f501480"],
];

test("the matrix freezes the exact five honest positive pairs and its bounded negative corpus", () => {
  assert.deepEqual(
    COMPATIBILITY_MATRIX_ROWS.map(({ kit, hyper }) => [kit.commit, hyper.commit]),
    exactPairs,
  );
  assert.deepEqual(COMPATIBILITY_MATRIX_ROWS.map(({ id }) => id), ["A", "B", "C", "D", "E"]);
  assert.deepEqual(COMPATIBILITY_MATRIX_ROWS.map(({ expectedProtocol }) => expectedProtocol), [
    "2.0",
    "2.0",
    "2.0",
    "3.0",
    "3.0",
  ]);
  // Only row E proves six-surface agreement. A row claiming canonicalSurfaces it
  // never measured is the overclaim the verifier exists to refuse.
  assert.equal(COMPATIBILITY_MATRIX_ROWS[3].canonicalSurfaces, null);
  assert.deepEqual(COMPATIBILITY_MATRIX_ROWS[3].scenarios, [
    "doctor_negotiated_v3",
    "historical_strict_next_v2",
  ]);
  assert.deepEqual(COMPATIBILITY_MATRIX_ROWS[4].canonicalSurfaces, [
    "run",
    "next",
    "resume",
    "checkpoint",
    "guard",
    "mcp",
  ]);
  assert.deepEqual(DELIBERATELY_UNSUPPORTED_CASES.map(({ category }) => category), [
    "future_protocol",
    "malformed_advertisement",
    "schema_hash_mismatch",
    "malformed_action",
    "wrong_returned_protocol",
    "semantic_contradiction",
    "explicit_unsupported_request",
  ]);
  assert.match(COMPATIBILITY_MATRIX_SHA256, /^[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(COMPATIBILITY_MATRIX_ROWS), true);
  assert.equal(Object.isFrozen(DELIBERATELY_UNSUPPORTED_CASES), true);
});

test("exact row selection supports bounded debug reruns without broadening pair scope", () => {
  assert.deepEqual(selectCompatibilityMatrixRows("A").map(({ id }) => id), ["A"]);
  assert.deepEqual(selectCompatibilityMatrixRows("E").map(({ id }) => id), ["E"]);
  assert.deepEqual(selectCompatibilityMatrixRows().map(({ id }) => id), ["A", "B", "C", "D", "E"]);
  assert.throws(() => selectCompatibilityMatrixRows("A,E"), /one exact matrix row/iu);
  assert.throws(() => selectCompatibilityMatrixRows("F"), /one exact matrix row/iu);
});
