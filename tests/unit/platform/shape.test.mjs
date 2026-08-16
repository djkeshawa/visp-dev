/**
 * The closed-shape guards. `exactKeys` is what makes a report shape CLOSED, so
 * the assertions that matter are the refusals: an extra field, a missing field,
 * and a value that is object-ish without being a plain object.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMIT,
  HASH,
  PREFIXED_HASH,
  exactArray,
  exactKeys,
  exactValue,
  plainObject,
  verifyCommit,
  verifyHash,
} from "../../../src/platform/shape.mjs";

test("plainObject accepts only a plain object", () => {
  assert.deepEqual(plainObject({ a: 1 }, "record"), { a: 1 });
  for (const value of [null, [], "text", 7, new Map(), Object.create(null)]) {
    assert.throws(() => plainObject(value, "record"), /record must be a plain object/u);
  }
});

test("exactKeys refuses both an extra field and a missing one", () => {
  exactKeys({ a: 1, b: 2 }, ["a", "b"], "record");
  // Order must not matter; the field SET is the contract.
  exactKeys({ b: 2, a: 1 }, ["b", "a"], "record");
  assert.throws(() => exactKeys({ a: 1, b: 2, c: 3 }, ["a", "b"], "record"), /unexpected field set/u);
  assert.throws(() => exactKeys({ a: 1 }, ["a", "b"], "record"), /unexpected field set/u);
});

test("exactValue compares deeply and names the drift the caller cares about", () => {
  exactValue({ a: [1, 2] }, { a: [1, 2] }, "source");
  assert.throws(
    () => exactValue({ a: [2, 1] }, { a: [1, 2] }, "source"),
    /source drifted from its frozen definition/u,
  );
  assert.throws(
    () => exactValue({ a: 1 }, { a: 2 }, "source", "does not match the pinned pair"),
    /source does not match the pinned pair/u,
  );
});

test("exactArray requires an array, in order", () => {
  exactArray([1, 2], [1, 2], "rows");
  assert.throws(() => exactArray([2, 1], [1, 2], "rows"), /does not match the frozen matrix/u);
  assert.throws(() => exactArray({ 0: 1 }, [1], "rows"), /does not match the frozen matrix/u);
});

test("the digest patterns admit exactly the shapes the reports carry", () => {
  assert.ok(HASH.test("a".repeat(64)));
  assert.ok(!HASH.test("a".repeat(63)));
  assert.ok(!HASH.test(`sha256:${"a".repeat(64)}`));
  assert.ok(PREFIXED_HASH.test(`sha256:${"a".repeat(64)}`));
  assert.ok(!PREFIXED_HASH.test("a".repeat(64)));
  assert.ok(COMMIT.test("a".repeat(40)));
  // Abbreviated commits are refused everywhere: a short ID is not an identity.
  assert.ok(!COMMIT.test("a".repeat(7)));
  assert.ok(!COMMIT.test("A".repeat(40)));
});

test("verifyHash and verifyCommit refuse non-strings as well as bad shapes", () => {
  verifyHash("a".repeat(64), "tarball");
  verifyCommit("a".repeat(40), "commit");
  for (const value of [null, undefined, 7, ["a".repeat(64)]]) {
    assert.throws(() => verifyHash(value, "tarball"), /tarball is invalid/u);
    assert.throws(() => verifyCommit(value, "commit"), /commit is invalid/u);
  }
  assert.throws(() => verifyHash("a".repeat(40), "tarball"), /tarball is invalid/u);
  assert.throws(() => verifyCommit("a".repeat(64), "commit"), /commit is invalid/u);
});
