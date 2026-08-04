import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { canonicalStringify, sha256Hex } from "../src/compatibility-lab.mjs";
import { REQUIRED_FAMILIES, runConformance, verifyConformanceReport } from "../src/conformance.mjs";
import {
  D107_PHASE_6_EVIDENCE,
  D107_PLATFORM_PROVENANCE,
  evaluateReleaseEvidence,
  verifyReviewedPlatformProvenanceReport
} from "../src/release-evidence.mjs";
import {
  candidate,
  platformReport,
  platformProvenance,
  reseal,
  syntheticPhase6Report
} from "./helpers/release-evidence-fixtures.mjs";

const committed = JSON.parse(
  readFileSync(new URL("../evidence/conformance-linux-x64-node24.json", import.meta.url), "utf8")
);

function readEvidence(relative) {
  const bytes = readFileSync(new URL(`../evidence/${relative}`, import.meta.url));

  return { report: JSON.parse(bytes), fileSha256: sha256Hex(bytes) };
}

function legacyV1From(report) {
  const legacy = structuredClone(report);

  legacy.schemaVersion = "visp.conformance.v1";
  delete legacy.evidenceFiles;
  delete legacy.releaseEvidence;
  for (const artifact of legacy.candidate.artifacts) delete artifact.tree;
  delete legacy.reportSha256;
  legacy.reportSha256 = sha256Hex(canonicalStringify(legacy));

  return legacy;
}

function resealAggregate(report) {
  delete report.reportSha256;
  report.reportSha256 = sha256Hex(canonicalStringify(report));

  return report;
}

test("the committed conformance report verifies and is current", async () => {
  assert.equal(committed.schemaVersion, "visp.conformance.v2");
  assert.equal(verifyConformanceReport(committed), true);
  const rebuilt = await runConformance();
  assert.deepEqual(committed, rebuilt);
});

test("the historical v1 aggregate remains verifiable but carries no C1 eligibility", () => {
  const legacy = legacyV1From(committed);

  assert.equal(verifyConformanceReport(legacy), true);
  assert.equal("releaseEvidence" in legacy, false);
  assert.equal(legacy.verdict, "complete");
});

test("v1 and v2 fields cannot be laundered by relabeling and rehashing", () => {
  const legacy = legacyV1From(committed);
  const v1WithEligibility = structuredClone(legacy);

  v1WithEligibility.releaseEvidence = { eligible: true, issues: [] };
  delete v1WithEligibility.reportSha256;
  v1WithEligibility.reportSha256 = sha256Hex(canonicalStringify(v1WithEligibility));
  assert.throws(
    () => verifyConformanceReport(v1WithEligibility),
    /Legacy conformance report has an unexpected field set/u
  );

  const relabeledV2 = structuredClone(committed);

  relabeledV2.schemaVersion = "visp.conformance.v1";
  delete relabeledV2.reportSha256;
  relabeledV2.reportSha256 = sha256Hex(canonicalStringify(relabeledV2));
  assert.throws(
    () => verifyConformanceReport(relabeledV2),
    /Legacy conformance report has an unexpected field set/u
  );

  const relabeledV1 = structuredClone(legacy);

  relabeledV1.schemaVersion = "visp.conformance.v2";
  delete relabeledV1.reportSha256;
  relabeledV1.reportSha256 = sha256Hex(canonicalStringify(relabeledV1));
  assert.throws(
    () => verifyConformanceReport(relabeledV1),
    /C1 conformance report has an unexpected field set/u
  );
});

test("v2 binds every family to its exact reviewed evidence paths and inner hashes", () => {
  const substituted = structuredClone(committed);

  substituted.families.forEach((family, familyIndex) => {
    family.reports.forEach((report, reportIndex) => {
      report.path = `evidence/substituted-${familyIndex}-${reportIndex}.json`;
      report.reportSha256 = "f".repeat(64);
    });
  });
  assert.throws(
    () => verifyConformanceReport(resealAggregate(substituted)),
    /exact evidence path set/u
  );

  const wrongHash = structuredClone(committed);

  wrongHash.families[0].reports[0].reportSha256 = "f".repeat(64);
  assert.throws(
    () => verifyConformanceReport(resealAggregate(wrongHash)),
    /reviewed inner report hash/u
  );

  const duplicateAndOmitted = structuredClone(committed);

  duplicateAndOmitted.families[0].reports[0] = structuredClone(
    duplicateAndOmitted.families[0].reports[1]
  );
  assert.throws(
    () => verifyConformanceReport(resealAggregate(duplicateAndOmitted)),
    /exact evidence path set/u
  );
});

test("v2 freezes a closed raw-file and inner-report source manifest", () => {
  const paths = committed.evidenceFiles.map((entry) => entry.path);
  const byPath = Object.fromEntries(committed.evidenceFiles.map((entry) => [entry.path, entry]));

  assert.equal(new Set(paths).size, paths.length);
  assert.deepEqual(
    [...paths].sort(),
    [...new Set(REQUIRED_FAMILIES.flatMap((family) => family.evidence))].sort()
  );
  assert.deepEqual(byPath["evidence/phase-6-pair-linux-x64-node24.json"], {
    fileSha256: D107_PHASE_6_EVIDENCE.fileSha256,
    path: "evidence/phase-6-pair-linux-x64-node24.json",
    present: true,
    reportSha256: D107_PHASE_6_EVIDENCE.reportSha256
  });
  for (const artifact of D107_PLATFORM_PROVENANCE.artifacts) {
    assert.deepEqual(byPath[artifact.destinationPath], {
      fileSha256: artifact.rawFileSha256,
      path: artifact.destinationPath,
      present: true,
      reportSha256: artifact.reportSha256
    });
  }
  assert.deepEqual(byPath["evidence/release-candidate-linux-x64-node24.json"], {
    fileSha256: "c4313e2d790a44a759afca8da5d1442bd1f669cbd91793894bcfae492e34751a",
    path: "evidence/release-candidate-linux-x64-node24.json",
    present: true,
    reportSha256: "074f01f848d72543ca951766f92abe7e52295135e543b7915da975b85128717e"
  });
  assert.deepEqual(byPath["evidence/conformance-fixtures-run-30686678616.json"], {
    fileSha256: "da0bddebf24ea289219b4d601e8ce97a9db6ab8001aafff7fecc50659cac8f12",
    path: "evidence/conformance-fixtures-run-30686678616.json",
    present: true,
    reportSha256: "321ab76fc5b9e14b96dab4d28ae1fcd8763ad8535c16b2fb113c7b447a8fe52e"
  });

  const wrongRawHash = structuredClone(committed);

  wrongRawHash.evidenceFiles[0].fileSha256 = "f".repeat(64);
  assert.throws(
    () => verifyConformanceReport(resealAggregate(wrongRawHash)),
    /reviewed raw-file hash/u
  );

  const wrongInnerHash = structuredClone(committed);

  wrongInnerHash.evidenceFiles[0].reportSha256 = "f".repeat(64);
  assert.throws(
    () => verifyConformanceReport(resealAggregate(wrongInnerHash)),
    /reviewed inner report hash/u
  );

  const duplicateAndOmitted = structuredClone(committed);

  duplicateAndOmitted.evidenceFiles[0] = structuredClone(duplicateAndOmitted.evidenceFiles[1]);
  assert.throws(
    () => verifyConformanceReport(resealAggregate(duplicateAndOmitted)),
    /exact evidence path set/u
  );

  const concealedMissing = structuredClone(committed);
  const hostFamily = concealedMissing.families.find((family) => family.id === "host");
  const hostSource = concealedMissing.evidenceFiles.find(
    (entry) => entry.path === hostFamily.reports[0].path
  );

  hostFamily.reports[0].present = false;
  hostFamily.reports[0].reportSha256 = null;
  hostSource.present = false;
  hostSource.fileSha256 = null;
  hostSource.reportSha256 = null;
  assert.throws(
    () => verifyConformanceReport(resealAggregate(concealedMissing)),
    /status contradicts its evidence presence/u
  );
});

test("legacy v1 keeps integrity-only family references", () => {
  const legacy = legacyV1From(committed);

  legacy.families[0].reports[0].path = "evidence/historical-location.json";
  legacy.families[0].reports[0].reportSha256 = "f".repeat(64);

  assert.equal(verifyConformanceReport(resealAggregate(legacy)), true);
});

test("aligned D-107 evidence is eligible and a rehashed/rebound mixed fixture fails closed", () => {
  const packedPhase6 = readEvidence("phase-6-pair-linux-x64-node24.json");
  const linuxEvidence = readEvidence("conformance-fixtures-linux-x64-node24.json");
  const darwinEvidence = readEvidence("conformance-fixtures-darwin-arm64-node24.json");
  const provenanceEvidence = readEvidence("conformance-fixtures-run-30686678616.json");
  const aligned = evaluateReleaseEvidence({
    candidate,
    phase6: packedPhase6.report,
    phase6FileSha256: packedPhase6.fileSha256,
    linux: linuxEvidence.report,
    linuxFileSha256: linuxEvidence.fileSha256,
    darwin: darwinEvidence.report,
    darwinFileSha256: darwinEvidence.fileSha256,
    platformProvenance: provenanceEvidence.report
  });

  assert.equal(aligned.eligible, true);
  assert.deepEqual(aligned.issues, []);

  const linux = platformReport({ operatingSystem: "linux", architecture: "x64" });
  const darwin = platformReport({ operatingSystem: "darwin", architecture: "arm64" });
  const mixed = structuredClone(darwin);

  mixed.packages.hyper.commit = "6".repeat(40);
  mixed.packages.hyper.tarballSha256 = "6".repeat(64);
  const sealedMixed = reseal(mixed);
  const reboundProvenance = platformProvenance(linux, sealedMixed);
  const rejected = evaluateReleaseEvidence({
    candidate,
    phase6: packedPhase6.report,
    phase6FileSha256: packedPhase6.fileSha256,
    linux,
    linuxFileSha256: sha256Hex(canonicalStringify(linux)),
    darwin: sealedMixed,
    darwinFileSha256: sha256Hex(canonicalStringify(sealedMixed)),
    platformProvenance: reboundProvenance
  });

  assert.equal(rejected.eligible, false);
  assert.ok(rejected.issues.some((issue) => issue.code === "package_identity_mismatch"));
});

test("reviewed evidence allowlists are deeply immutable", () => {
  assert.throws(() => {
    D107_PLATFORM_PROVENANCE.run.runId = "999999";
  });
  assert.throws(() => {
    D107_PLATFORM_PROVENANCE.artifacts[0].artifactId = "1";
  });
  assert.throws(() => {
    D107_PHASE_6_EVIDENCE.runIdentity.runId = "synthetic";
  });
});

test("a resealed and rebound known defect cannot become release-eligible", () => {
  const packedPhase6 = readEvidence("phase-6-pair-linux-x64-node24.json");
  const linux = platformReport({ operatingSystem: "linux", architecture: "x64" });
  const darwin = platformReport({ operatingSystem: "darwin", architecture: "arm64" });
  const defect = structuredClone(darwin);
  const [fixture] = defect.fixtures;

  fixture.status = "known_defect";
  defect.summary.passed = 10;
  defect.summary.knownDefects = 1;
  defect.summary.knownDefectIds = [fixture.id];
  const sealedDefect = reseal(defect);
  const provenance = platformProvenance(linux, sealedDefect);
  const result = evaluateReleaseEvidence({
    candidate,
    phase6: packedPhase6.report,
    phase6FileSha256: packedPhase6.fileSha256,
    linux,
    linuxFileSha256: sha256Hex(canonicalStringify(linux)),
    darwin: sealedDefect,
    darwinFileSha256: sha256Hex(canonicalStringify(sealedDefect)),
    platformProvenance: provenance
  });

  assert.equal(result.eligible, false);
  assert.ok(result.issues.some((issue) => issue.code === "fixture_failure"));
});

test("legacy platform reports expose only observed anchors when the candidate is missing", () => {
  const phase6 = readEvidence("phase-6-pair-linux-x64-node24.json");
  const linux = readEvidence("conformance-fixtures-linux-x64-node24.json");
  const darwin = readEvidence("conformance-fixtures-darwin-arm64-node24.json");
  const provenance = readEvidence("conformance-fixtures-run-30686678616.json");
  const result = evaluateReleaseEvidence({
    candidate: null,
    phase6: phase6.report,
    phase6FileSha256: phase6.fileSha256,
    linux: linux.report,
    linuxFileSha256: linux.fileSha256,
    darwin: darwin.report,
    darwinFileSha256: darwin.fileSha256,
    platformProvenance: provenance.report
  });

  assert.equal(result.eligible, false);
  assert.equal(result.resolvedPackages, null);
  assert.deepEqual(Object.keys(result.identities.linux.kit).sort(), ["commit", "tarballSha256"]);
  assert.deepEqual(Object.keys(result.identities.darwin.hyper).sort(), ["commit", "tarballSha256"]);
});

test("a relabeled and rehashed synthetic Phase 6 report is not reviewed packed evidence", () => {
  const phase6 = syntheticPhase6Report();
  const linux = readEvidence("conformance-fixtures-linux-x64-node24.json");
  const darwin = readEvidence("conformance-fixtures-darwin-arm64-node24.json");
  const provenance = readEvidence("conformance-fixtures-run-30686678616.json");

  phase6.producer = "packed-runner";
  const relabeled = reseal(phase6);
  const result = evaluateReleaseEvidence({
    candidate,
    phase6: relabeled,
    phase6FileSha256: sha256Hex(canonicalStringify(relabeled)),
    linux: linux.report,
    linuxFileSha256: linux.fileSha256,
    darwin: darwin.report,
    darwinFileSha256: darwin.fileSha256,
    platformProvenance: provenance.report
  });

  assert.equal(result.eligible, false);
  assert.ok(result.issues.some((issue) => issue.code === "phase6_not_reviewed"));
});

test("a coherently resealed fake GitHub run is not reviewed platform provenance", () => {
  const phase6 = readEvidence("phase-6-pair-linux-x64-node24.json");
  const linux = readEvidence("conformance-fixtures-linux-x64-node24.json");
  const darwin = readEvidence("conformance-fixtures-darwin-arm64-node24.json");
  const provenance = readEvidence("conformance-fixtures-run-30686678616.json").report;
  const fake = structuredClone(provenance);

  fake.run.runId = "999999";
  fake.run.runAttempt = "7";
  fake.run.headSha = "9".repeat(40);
  fake.run.url = "https://github.com/djkeshawa/visp-dev/actions/runs/999999";
  fake.artifacts.forEach((artifact, index) => {
    artifact.artifactId = `99999${index + 1}`;
    artifact.artifactUrl = `https://api.github.com/repos/djkeshawa/visp-dev/actions/artifacts/${artifact.artifactId}`;
    artifact.artifactDigestSha256 = `${index + 1}`.repeat(64);
    artifact.workflowRunId = fake.run.runId;
    artifact.headSha = fake.run.headSha;
  });
  const resealed = reseal(fake);
  assert.throws(
    () => verifyReviewedPlatformProvenanceReport(resealed),
    /reviewed D-107 run and artifacts/u
  );
  const result = evaluateReleaseEvidence({
    candidate,
    phase6: phase6.report,
    phase6FileSha256: phase6.fileSha256,
    linux: linux.report,
    linuxFileSha256: linux.fileSha256,
    darwin: darwin.report,
    darwinFileSha256: darwin.fileSha256,
    platformProvenance: resealed
  });

  assert.equal(result.eligible, false);
  assert.ok(result.issues.some((issue) => issue.code === "provenance_not_reviewed"));
});

test("making the reviewed pin a parameter did not create an accept-anything default", () => {
  // P12: the reviewed pins became data so a NEW pair can be reviewed without a
  // code change. The hazard in that refactor is the obvious one — an omitted
  // argument silently meaning "no pin, accept anything". These assertions exist
  // so that hole cannot open unnoticed.
  const provenance = readEvidence("conformance-fixtures-run-30686678616.json").report;
  const fake = structuredClone(provenance);
  fake.run.runId = "424242";
  fake.run.url = "https://github.com/djkeshawa/visp-dev/actions/runs/424242";
  fake.artifacts.forEach((artifact) => {
    artifact.workflowRunId = fake.run.runId;
  });
  const resealed = reseal(fake);

  // Called with NO reviewed pin at all: must still reject.
  assert.throws(() => verifyReviewedPlatformProvenanceReport(resealed), /reviewed D-107/u);

  // The genuine article still passes with no pin supplied, so the default is
  // the real D-107 set rather than a permissive stub.
  assert.equal(verifyReviewedPlatformProvenanceReport(provenance), true);

  // And an explicitly supplied pin is honoured: reviewing a different run is
  // possible, which is the entire point of the refactor.
  assert.equal(
    verifyReviewedPlatformProvenanceReport(resealed, {
      artifacts: resealed.artifacts,
      run: resealed.run
    }),
    true
  );
});

test("required families are declared independently of the evidence that exists", () => {
  // If families were derived from the evidence, every gap would vanish by
  // construction and the report would always read complete.
  const declared = REQUIRED_FAMILIES.map((family) => family.id);
  for (const id of ["hook", "operating_system", "security", "failure_mode"]) {
    assert.ok(declared.includes(id), `${id} must be required independently of its evidence`);
  }

  // The operating_system family named macOS before the evidence existed and
  // still names it now that the exact report is provenance-bound. Removing it
  // would erase the requirement rather than report future evidence loss.
  const operatingSystem = REQUIRED_FAMILIES.find((family) => family.id === "operating_system");

  assert.ok(operatingSystem.evidence.some((entry) => entry.includes("darwin")));

  // Windows is deliberately absent. The fixtures install from a mode-faithful
  // snapshot and Windows has no POSIX mode bits, so that evidence is not
  // reproducible there. Adding the file back would demand evidence that cannot
  // be produced; relaxing the snapshot to produce it would weaken every other
  // platform's evidence. Documented in docs/platform-support.md.
  assert.ok(!operatingSystem.evidence.some((entry) => entry.includes("win32")));
});

test("the verdict is derived from the gaps, never stated alongside them", () => {
  // This used to assert `partial` and `gapIds: ["operating_system"]` — the state
  // of the day it was written. It then failed the moment the last gap closed,
  // which is the wrong signal entirely: closing a gap is the goal, not a
  // regression. The invariant worth protecting is that the verdict cannot
  // disagree with the gap list, in either direction.
  assert.equal(committed.verdict, committed.summary.gaps === 0 ? "complete" : "partial");
  assert.equal(committed.summary.gaps, committed.summary.gapIds.length);
  assert.equal(
    committed.summary.covered + committed.summary.gaps,
    committed.summary.required,
  );

  // Every family the report calls a gap must actually lack a present report, so
  // "gap" cannot become a label applied by hand.
  for (const family of committed.families) {
    const missing = family.reports.filter((entry) => !entry.present);

    assert.equal(
      committed.summary.gapIds.includes(family.id),
      missing.length > 0,
      `${family.id} is listed as a gap without missing evidence, or vice versa`,
    );
  }
});

test("coverage does not conceal the defects the evidence recorded", () => {
  // A family can be fully evidenced and still unhealthy, so the report carries
  // defects separately from coverage. F-C1 and F-C2 are fixed, so this reads
  // clean — but it reads clean because the underlying fixtures pass, not
  // because the report stopped looking.
  assert.deepEqual(committed.summary.knownDefects, []);

  const failureMode = committed.families.find((family) => family.id === "failure_mode");

  assert.equal(failureMode.status, "covered");
  assert.ok(
    Array.isArray(failureMode.knownDefects),
    "the field must survive being empty, or a later defect has nowhere to appear"
  );
});

test("a report claiming completeness while listing gaps is rejected", () => {
  // Tampering is caught by the hash.
  const tampered = structuredClone(committed);

  tampered.summary.covered += 1;
  assert.throws(() => verifyConformanceReport(tampered), /hash does not match/u);

  // The overclaim guard is a separate rule, and it needs a lie that survives the
  // hash — otherwise the hash fires first and the guard is never consulted. The
  // previous version of this test only flipped `verdict` and asserted a hash
  // mismatch, so it would have passed with the completeness rule deleted. Once
  // the last gap closed it stopped testing anything at all, because the verdict
  // it set was the verdict already there.
  const lying = structuredClone(committed);
  const family = lying.families.find((entry) => entry.id === "host");

  family.reports[0].present = false;
  family.reports[0].reportSha256 = null;
  const source = lying.evidenceFiles.find((entry) => entry.path === family.reports[0].path);

  source.present = false;
  source.fileSha256 = null;
  source.reportSha256 = null;
  family.status = "evidence_missing";
  lying.summary.covered -= 1;
  lying.summary.gaps += 1;
  lying.summary.gapIds = [...lying.summary.gapIds, family.id].sort();
  lying.verdict = "complete";

  delete lying.reportSha256;
  lying.reportSha256 = sha256Hex(canonicalStringify(lying));

  assert.throws(
    () => verifyConformanceReport(lying),
    /claims completeness while reporting gaps/u,
  );
});

test("a rehashed aggregate cannot claim eligibility while carrying identity issues", async () => {
  const contradictory = await runConformance();

  contradictory.releaseEvidence.issues.push({
    code: "package_identity_mismatch",
    detail: "synthetic contradiction",
    report: "candidate"
  });
  contradictory.releaseEvidence.eligible = true;
  delete contradictory.reportSha256;
  contradictory.reportSha256 = sha256Hex(canonicalStringify(contradictory));

  assert.throws(
    () => verifyConformanceReport(contradictory),
    /eligibility contradicts its issues/u
  );
});

test("a rehashed aggregate cannot omit its exact shared platform run identity", async () => {
  const contradictory = await runConformance();

  contradictory.releaseEvidence.platformRunIdentity = {};
  delete contradictory.reportSha256;
  contradictory.reportSha256 = sha256Hex(canonicalStringify(contradictory));

  assert.throws(() => verifyConformanceReport(contradictory), /platform run identity/u);
});

test("a rehashed aggregate cannot replace the reviewed run with a fictional numeric run", async () => {
  const contradictory = await runConformance();

  contradictory.releaseEvidence.platformRunIdentity = {
    provider: "github-actions",
    runAttempt: "7",
    runId: "999999"
  };
  delete contradictory.reportSha256;
  contradictory.reportSha256 = sha256Hex(canonicalStringify(contradictory));

  assert.throws(() => verifyConformanceReport(contradictory), /platform run identity/u);
});

test("a rehashed aggregate cannot erase family known defects from its summary", async () => {
  const contradictory = await runConformance();

  contradictory.families[0].knownDefects = ["synthetic-known-defect"];
  delete contradictory.reportSha256;
  contradictory.reportSha256 = sha256Hex(canonicalStringify(contradictory));

  assert.throws(() => verifyConformanceReport(contradictory), /summary does not match/u);
});

test("a rehashed aggregate candidate must contain exactly Kit and Hyper once each", async () => {
  const contradictory = await runConformance();

  contradictory.candidate.artifacts.push({
    ...contradictory.candidate.artifacts[0],
    name: "extra-package"
  });
  delete contradictory.reportSha256;
  contradictory.reportSha256 = sha256Hex(canonicalStringify(contradictory));

  assert.throws(() => verifyConformanceReport(contradictory), /exactly one Kit and one Hyper/u);
});

test("a mutually coherent fake identity cannot replace the frozen D-107 identity", async () => {
  const contradictory = await runConformance();
  const fake = structuredClone(contradictory.releaseEvidence.expectedPackages);

  for (const [id, version] of [["kit", "9.9.9"], ["hyper", "8.8.8"]]) {
    fake[id].version = version;
    fake[id].commit = id === "kit" ? "9".repeat(40) : "8".repeat(40);
    fake[id].tree = id === "kit" ? "7".repeat(40) : "6".repeat(40);
    fake[id].tarballSha256 = id === "kit" ? "5".repeat(64) : "4".repeat(64);
  }
  contradictory.releaseEvidence.expectedPackages = structuredClone(fake);
  contradictory.releaseEvidence.resolvedPackages = structuredClone(fake);
  contradictory.releaseEvidence.identities.candidate = structuredClone(fake);
  contradictory.releaseEvidence.identities.phase6 = structuredClone(fake);
  for (const reportName of ["linux", "darwin"]) {
    for (const id of ["kit", "hyper"]) {
      contradictory.releaseEvidence.identities[reportName][id] = {
        commit: fake[id].commit,
        tarballSha256: fake[id].tarballSha256
      };
    }
  }
  contradictory.candidate.artifacts = Object.values(fake);
  delete contradictory.reportSha256;
  contradictory.reportSha256 = sha256Hex(canonicalStringify(contradictory));

  assert.throws(() => verifyConformanceReport(contradictory), /frozen D-107 identity/u);
});

test("every covered family names the evidence that covers it", () => {
  for (const family of committed.families.filter((entry) => entry.status === "covered")) {
    assert.ok(family.reports.length > 0, `${family.id} claims coverage with no evidence`);
    for (const report of family.reports) {
      assert.equal(report.present, true);
      assert.match(report.reportSha256, /^[0-9a-f]{64}$/u);
    }
  }
});

test("conformance is measured against the assembled release candidate", () => {
  assert.equal(committed.candidate.status, "assembled_not_published");
  assert.ok(committed.candidate.artifacts.length >= 2);
});
