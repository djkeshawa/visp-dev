/**
 * GUTTED, not deleted, when the committed evidence directory was removed.
 *
 * What died: the `committed` report and the assertion that it was genuine
 * packed evidence. Everything else survives, now driven by a synthetic report
 * built here — the shared fixture helper died with the evidence it read.
 *
 * A synthetic report is a STRUCTURAL fixture and never positive proof about the
 * published pair: `producer` says `synthetic-constructor`, and only the packed
 * runner can say otherwise.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { canonicalStringify, sha256Hex } from "../../../../../src/platform/canonical-json.mjs";
import {
  PUBLISHED_ARTIFACT_DIFFERENTIAL_DEFINITION as DEFINITION,
  PUBLISHED_ARTIFACT_DIFFERENTIAL_SHA256 as SHA256,
  createPublishedArtifactDifferentialReport,
  verifyPublishedArtifactDifferentialReport,
} from "../../../../../src/compatibility/suites/published-artifact-differential/index.mjs";

const RUN_IDENTITY = { provider: "local", runAttempt: "1", runId: "published-pair-test" };

const ENVIRONMENT = {
  architecture: "x64",
  git: "git version 2.49.0",
  node: "v24.15.0",
  npm: "11.12.1",
  operatingSystem: "linux",
  pnpm: "11.3.0",
};

/** A packed record shaped exactly as `packAndInstall` returns one. */
function packedPackage(identity) {
  return {
    source: { commit: identity.commit, tree: identity.tree },
    pack: {
      first: {
        package: { name: identity.name, version: identity.version },
        sha256: identity.tarballSha256,
      },
    },
  };
}

/**
 * Three rows whose surface views are identical apart from `actionId`, which is
 * per-row — exactly the shape a real run produces, and the shape the
 * differential is defined to compare.
 */
function compatibilityRows() {
  return DEFINITION.compatibility.map((row) => {
    const view = {
      actionId: `sha256:${sha256Hex(`action-${row.id}`)}`,
      ...DEFINITION.expectedView,
      protocolVersion: row.expectedProtocol,
      schemaHash: row.expectedSchemaHash,
    };
    return {
      id: row.id,
      surfaces: DEFINITION.surfaces.map((id) => ({ id, view: structuredClone(view) })),
    };
  });
}

function syntheticReport(runIdentity = RUN_IDENTITY) {
  return createPublishedArtifactDifferentialReport({
    compatibility: compatibilityRows(),
    environment: ENVIRONMENT,
    packages: Object.fromEntries(
      Object.entries(DEFINITION.packages).map(([id, identity]) => [id, packedPackage(identity)]),
    ),
    runIdentity,
  });
}

function rehash(report) {
  delete report.reportSha256;
  report.reportSha256 = sha256Hex(canonicalStringify(report));
  return report;
}

test("the frozen definition is deeply immutable", () => {
  assert.throws(() => {
    DEFINITION.packages.kitFixed.commit = "0".repeat(40);
  });
  assert.throws(() => {
    DEFINITION.compatibility.push({ id: "smuggled" });
  });
  assert.match(SHA256, /^[0-9a-f]{64}$/u);
});

test("the definition digest is the value docs/compatibility.md pins", () => {
  // This digest is quoted in prose. If it moves, the document is wrong and a
  // reader following it verifies the wrong pin.
  assert.equal(SHA256, "155bdf2cc0930acd507c1f64103ed980119180465e231f3aa03795b4d3d08daa");
});

test("a newly produced report verifies and carries its run identity", () => {
  const report = syntheticReport();
  assert.equal(verifyPublishedArtifactDifferentialReport(report), true);
  assert.equal(report.definitionSha256, SHA256);
  assert.equal(report.schemaHash, DEFINITION.schemaHash);
  assert.deepEqual(report.runIdentity, RUN_IDENTITY);
  assert.equal(report.compatibility.length, 3);
});

test("a synthetic report cannot claim to be a packed run", () => {
  // The producer token is module-private, so no fixture can forge `packed-runner`.
  assert.equal(syntheticReport().producer, "synthetic-constructor");
});

test("every surface negotiated protocol 3.2 on the unchanged schema hash", () => {
  for (const row of syntheticReport().compatibility) {
    assert.equal(row.surfaces.length, DEFINITION.surfaces.length);
    for (const surface of row.surfaces) {
      assert.equal(surface.view.protocolVersion, "3.2", `${row.id}/${surface.id}`);
      assert.equal(surface.view.schemaHash, DEFINITION.schemaHash, `${row.id}/${surface.id}`);
    }
  }
});

test("the corrected Kit matches the previous Kit on a healthy project", () => {
  // The claim this suite exists to make: the fail-closed corrections changed
  // behaviour only for input that was already broken. An integrator running
  // healthy projects observes nothing new.
  const report = syntheticReport();
  assert.equal(report.differential.identical, true);
  assert.equal(report.differential.corrected, "fixed_kit_current_hyper");
  assert.equal(report.differential.baseline, "previous_kit_current_hyper");
});

test("a failed differential is rejected rather than reported", () => {
  const lying = syntheticReport();
  lying.differential.identical = false;
  assert.throws(
    () => verifyPublishedArtifactDifferentialReport(rehash(lying)),
    /differential result does not match/u,
  );
});

test("rows that genuinely disagree fail construction instead of being recorded", () => {
  const rows = compatibilityRows();
  const corrected = rows.find((row) => row.id === DEFINITION.differential.corrected);
  for (const surface of corrected.surfaces) surface.view.nextCommand = "visp ship --task T001";
  assert.throws(
    () => createPublishedArtifactDifferentialReport({
      compatibility: rows,
      environment: ENVIRONMENT,
      packages: Object.fromEntries(
        Object.entries(DEFINITION.packages).map(([id, identity]) => [id, packedPackage(identity)]),
      ),
      runIdentity: RUN_IDENTITY,
    }),
    /semantic observation/u,
  );
});

test("a report whose packages drift from the frozen pair is rejected", () => {
  const drifted = syntheticReport();
  drifted.packages.kitFixed.commit = "0".repeat(40);
  assert.throws(
    () => verifyPublishedArtifactDifferentialReport(rehash(drifted)),
    /drifted from the frozen published-artifact differential definition/u,
  );
});

test("rehashed omissions and semantic rewrites cannot weaken the evidence", () => {
  const missingPackage = syntheticReport();
  delete missingPackage.packages.hyperCurrent;
  assert.throws(
    () => verifyPublishedArtifactDifferentialReport(rehash(missingPackage)),
    /packages has an unexpected field set/u,
  );

  const missingSurface = syntheticReport();
  missingSurface.compatibility[0].surfaces.pop();
  assert.throws(
    () => verifyPublishedArtifactDifferentialReport(rehash(missingSurface)),
    /compatibility fixed_kit_previous_hyper drifted/u,
  );

  const rewritten = syntheticReport();
  for (const surface of rewritten.compatibility[0].surfaces) {
    surface.view.nextCommand = "visp done --task T001";
  }
  assert.throws(
    () => verifyPublishedArtifactDifferentialReport(rehash(rewritten)),
    /semantic observation drifted/u,
  );
});

test("an invalid run identity is refused", () => {
  assert.throws(() => syntheticReport({ provider: "somewhere", runAttempt: "1", runId: "x" }));
  assert.throws(() => syntheticReport({ provider: "local", runAttempt: "0", runId: "x" }));
  assert.throws(() => syntheticReport({ provider: "local", runAttempt: "1", runId: "" }));
});

test("the pinned pair names the exact D-107 artifacts and preserves the historical baseline", () => {
  // If Kit moves again, this is what notices the evidence describes an older Kit
  // than the repository holds. `compatibility:currency` is the tool that says
  // whether that gap matters; this assertion is what makes the gap visible.
  assert.deepEqual(DEFINITION.packages.kitFixed, {
    commit: "eb70bce84568e9237690be1eea61355bbff23157",
    name: "visp-kit",
    tarballSha256: "1261d18eee28f7f196ab94d5099b54a3f66c36c74dfd1fab83bbba86f1f7e538",
    tree: "c1cef391194a20a57704bfaa6ed36c7f1b163756",
    version: "0.2.3",
  });
  assert.deepEqual(DEFINITION.packages.hyperCurrent, {
    commit: "3538457ae51f79245358321668c1f3566c5eac74",
    name: "visp-hyper-agent",
    tarballSha256: "27ce00657b98b8303119122fe5851300059a21581ff5a4ab7f0cc4c3a08a89e2",
    tree: "55ca7ea10865630119f792eb227c9634e0fee8f9",
    version: "0.4.3",
  });
  assert.equal(
    DEFINITION.packages.kitPrevious.commit,
    "19d5ffb3276e52462a945c66043f48e31cd6b38f",
  );
});
