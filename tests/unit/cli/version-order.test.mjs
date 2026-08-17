/**
 * LC-111 defect 1 — version comparison must be numeric.
 *
 * `visp-dev doctor` printed `[unknown] Node: v26.7.0 … the pairs in this matrix
 * require >=22`. 26 clears 22, so the row was reporting a machine as unusable
 * against a requirement it plainly met. These tests pin the comparison itself:
 * 22, 24 and 26 against the floor the matrix actually states, and a pre-release,
 * which is where a comparison that merely looks numeric stops being one.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  compareVersions,
  isNewerThan,
  parseVersion,
  satisfiesFloor
} from "../../../src/cli/version-order.mjs";

test("every supported Node major clears the floor the matrix states", () => {
  // The exact requirement in compatibility.json, against the majors a user can
  // plausibly be running. v26.7.0 is the machine that produced the ticket.
  for (const version of ["v22.0.0", "v22.14.0", "v24.15.0", "v26.7.0", "v30.0.0"]) {
    assert.equal(
      satisfiesFloor(version, ">=22"),
      true,
      `${version} was rejected against ">=22"; 22 is a floor, not a ceiling`
    );
  }
});

test("a Node below the floor is still rejected", () => {
  // The fix must not be "say yes to everything". `9` is the case a text
  // comparison gets wrong in the other direction: "9" > "22" as a string.
  for (const version of ["v9.11.0", "v18.20.0", "v20.11.0", "v21.7.3"]) {
    assert.equal(satisfiesFloor(version, ">=22"), false, `${version} must not satisfy ">=22"`);
  }
});

test("a floor with a minor is compared on the minor, not truncated to the major", () => {
  // `parseInt("22.5.0")` is 22, so a truncating comparison approves 22.1.0
  // against a >=22.5.0 floor — the same bug, one digit further right.
  assert.equal(satisfiesFloor("v22.1.0", ">=22.5.0"), false);
  assert.equal(satisfiesFloor("v22.5.0", ">=22.5.0"), true);
  assert.equal(satisfiesFloor("v22.6.0", ">=22.5.0"), true);
});

test("a pre-release ranks below the release it precedes", () => {
  // SemVer, and the honest answer: an rc of 22 is not 22. Node ships nightlies
  // and rcs, so this is a machine a user really has.
  assert.equal(satisfiesFloor("v22.0.0-rc.1", ">=22"), false);
  assert.equal(satisfiesFloor("v22.0.0-nightly20260101abcdef", ">=22"), false);
  // But a pre-release of a LATER major still clears the floor, because the
  // comparison happens on the core version first.
  assert.equal(satisfiesFloor("v23.0.0-nightly20260101abcdef", ">=22"), true);
  assert.equal(compareVersions("22.0.0-rc.1", "22.0.0"), -1);
  assert.equal(compareVersions("22.0.0-rc.1", "22.0.0-rc.2"), -1);
  assert.equal(compareVersions("22.0.0-rc.2", "22.0.0-rc.10"), -1);
  // Numeric identifiers rank below alphanumeric ones (SemVer §11).
  assert.equal(compareVersions("22.0.0-1", "22.0.0-alpha"), -1);
  assert.equal(compareVersions("22.0.0-rc.1", "22.0.0-rc.1"), 0);
});

test("a requirement that is not a floor is unknown rather than assumed", () => {
  // Reading `<25` as "at least 25" would approve exactly the machines it
  // excludes. The matrix only writes floors today; the day it writes something
  // else, doctor must say it does not know.
  assert.equal(satisfiesFloor("v26.7.0", "<25"), null);
  assert.equal(satisfiesFloor("v26.7.0", "^22"), null);
  assert.equal(satisfiesFloor("v26.7.0", "lts"), null);
  assert.equal(satisfiesFloor("v26.7.0", null), null);
  assert.equal(satisfiesFloor("not a version", ">=22"), null);
});

test("a bare floor and an explicit one mean the same thing", () => {
  assert.equal(satisfiesFloor("v26.7.0", "22"), true);
  assert.equal(satisfiesFloor("v26.7.0", ">= 22"), true);
  assert.equal(satisfiesFloor("v26.7.0", "v22"), true);
});

test("missing minor and patch read as zero rather than as absent", () => {
  assert.deepEqual(parseVersion("22"), { major: 22, minor: 0, patch: 0, prerelease: null });
  assert.deepEqual(parseVersion("v26.7"), { major: 26, minor: 7, patch: 0, prerelease: null });
  assert.deepEqual(parseVersion("0.9.0"), { major: 0, minor: 9, patch: 0, prerelease: null });
  assert.equal(parseVersion("none"), null);
  assert.equal(compareVersions("22", "22.0.0"), 0);
  assert.equal(compareVersions("nope", "22.0.0"), null);
});

test("newer is decided by number, and an unknown version is never newer", () => {
  // What the recovery advice turns on: 0.9.0 must read as newer than 0.8.0,
  // and 0.10.0 as newer than 0.9.0, which text comparison gets backwards.
  assert.equal(isNewerThan("0.9.0", "0.8.0"), true);
  assert.equal(isNewerThan("0.10.0", "0.9.0"), true);
  assert.equal(isNewerThan("0.8.0", "0.8.0"), false);
  assert.equal(isNewerThan("0.2.3", "0.5.0"), false);
  assert.equal(isNewerThan(null, "0.5.0"), false);
  assert.equal(isNewerThan("0.5.0", undefined), false);
});
