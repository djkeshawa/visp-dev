/**
 * `deepFreeze` guards every pinned `*_DEFINITION`, so what matters is that it
 * reaches all the way down. Six modules used to carry their own copy; a copy
 * that only froze the top level would leave a definition mutable after its hash
 * had already been taken.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { deepFreeze } from "../../../src/platform/freeze.mjs";

test("freezing reaches every nested object and array", () => {
  const definition = deepFreeze({
    pair: { kit: { commit: "a".repeat(40) } },
    profiles: [{ id: "routine", riskFactors: [{ code: "authorization" }] }],
    surfaces: ["run", "next"],
  });

  assert.equal(Object.isFrozen(definition), true);
  assert.equal(Object.isFrozen(definition.pair), true);
  assert.equal(Object.isFrozen(definition.pair.kit), true);
  assert.equal(Object.isFrozen(definition.profiles), true);
  assert.equal(Object.isFrozen(definition.profiles[0]), true);
  assert.equal(Object.isFrozen(definition.profiles[0].riskFactors[0]), true);
  assert.equal(Object.isFrozen(definition.surfaces), true);
});

test("a mutation deep inside a frozen definition does not take", () => {
  const definition = deepFreeze({ pair: { kit: { commit: "a".repeat(40) } }, surfaces: ["run"] });

  // Non-strict assignment is silently ignored; the point is that the value does
  // not change, whichever mode the caller happens to be in.
  assert.throws(() => {
    definition.pair.kit.commit = "b".repeat(40);
  }, TypeError);
  assert.throws(() => definition.surfaces.push("next"), TypeError);
  assert.equal(definition.pair.kit.commit, "a".repeat(40));
  assert.deepEqual(definition.surfaces, ["run"]);
});

test("primitives and null pass through unchanged", () => {
  assert.equal(deepFreeze(null), null);
  assert.equal(deepFreeze(7), 7);
  assert.equal(deepFreeze("run"), "run");
  assert.equal(deepFreeze(undefined), undefined);
});
