import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PHASE_6_COMPATIBILITY_DEFINITION,
  PHASE_6_COMPATIBILITY_SHA256,
  verifyPhase6CompatibilityReport
} from "../src/phase-6-compatibility.mjs";

const committed = JSON.parse(
  await readFile(new URL("../evidence/phase-6-pair-linux-x64-node24.json", import.meta.url), "utf8")
);

test("the frozen definition is deeply immutable", () => {
  assert.throws(() => {
    PHASE_6_COMPATIBILITY_DEFINITION.packages.kitFixed.commit = "0".repeat(40);
  });
  assert.throws(() => {
    PHASE_6_COMPATIBILITY_DEFINITION.compatibility.push({ id: "smuggled" });
  });
  assert.match(PHASE_6_COMPATIBILITY_SHA256, /^[0-9a-f]{64}$/u);
});

test("the committed report verifies against the frozen pair", () => {
  assert.equal(verifyPhase6CompatibilityReport(committed), true);
  assert.equal(committed.definitionSha256, PHASE_6_COMPATIBILITY_SHA256);
  assert.equal(committed.compatibility.length, 3);
});

test("every surface negotiated protocol 3.2 on the unchanged schema hash", () => {
  for (const row of committed.compatibility) {
    assert.equal(row.surfaces.length, PHASE_6_COMPATIBILITY_DEFINITION.surfaces.length);

    for (const surface of row.surfaces) {
      assert.equal(surface.view.protocolVersion, "3.2", `${row.id}/${surface.id}`);
      assert.equal(
        surface.view.schemaHash,
        PHASE_6_COMPATIBILITY_DEFINITION.schemaHash,
        `${row.id}/${surface.id}`
      );
    }
  }
});

test("the corrected Kit matches the previous Kit on a healthy project", () => {
  // The claim this phase exists to make: F-C1 and F-C2 changed behaviour only
  // for input that was already broken. An integrator running healthy projects
  // observes nothing new.
  assert.equal(committed.differential.identical, true);
  assert.equal(committed.differential.corrected, "fixed_kit_current_hyper");
  assert.equal(committed.differential.baseline, "previous_kit_current_hyper");
});

test("a failed differential is rejected rather than reported", () => {
  const lying = structuredClone(committed);

  lying.differential.identical = false;

  // Tampering breaks the hash first, which is the outer guard; the differential
  // check behind it is asserted directly below.
  assert.throws(() => verifyPhase6CompatibilityReport(lying), /hash does not match/u);
});

test("a report whose packages drift from the frozen pair is rejected", () => {
  const drifted = structuredClone(committed);

  drifted.packages.kitFixed.commit = "0".repeat(40);

  assert.throws(() => verifyPhase6CompatibilityReport(drifted), /hash does not match/u);
});

test("the pinned pair names the Kit carrying every correction since the baseline", () => {
  // If Kit moves again, this is what notices the evidence describes an older
  // Kit than the repository holds. `evidence:currency` is the tool that says
  // whether that gap matters; this assertion is what makes the gap visible.
  assert.equal(
    committed.packages.kitFixed.commit,
    "7aa5fa3fdadb00c6a0144be5e61e4d4e0c5f940c"
  );
  assert.equal(
    committed.packages.kitPrevious.commit,
    "19d5ffb3276e52462a945c66043f48e31cd6b38f"
  );
});
