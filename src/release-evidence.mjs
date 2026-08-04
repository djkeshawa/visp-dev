/**
 * Binds the D-107 candidate, the six-surface Phase 6 report, and both platform
 * fixture reports into one release-eligibility decision. This module witnesses
 * exact evidence identity; it grants no workflow or publication authority.
 */
import { canonicalStringify, sha256Hex } from "./compatibility-lab.mjs";
import {
  exactKeys,
  packageIdentityEqual,
  plainObject,
  verifyCommit,
  verifyHash,
  verifyPackageIdentity,
  verifyRunIdentity
} from "./evidence-identity.mjs";
import {
  PHASE_6_COMPATIBILITY_DEFINITION,
  verifyPhase6CompatibilityReport
} from "./phase-6-compatibility.mjs";
import {
  REQUIRED_FIXTURES,
  verifyConformanceFixtureReport
} from "./conformance-fixtures.mjs";

const PLATFORM_PATHS = {
  darwin: "evidence/conformance-fixtures-darwin-arm64-node24.json",
  linux: "evidence/conformance-fixtures-linux-x64-node24.json"
};

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const D107_PACKAGES = Object.freeze({
  hyper: PHASE_6_COMPATIBILITY_DEFINITION.packages.hyperCurrent,
  kit: PHASE_6_COMPATIBILITY_DEFINITION.packages.kitFixed
});

/** Reviewed GitHub evidence for the frozen C1 D-107 release decision. */
export const D107_PLATFORM_PROVENANCE = deepFreeze({
  run: {
    conclusion: "success",
    event: "push",
    headSha: "7662be94de9a0c707c9ad28d64a6c1a845d163f8",
    provider: "github-actions",
    repository: "djkeshawa/visp-dev",
    runAttempt: "1",
    runId: "30686678616",
    url: "https://github.com/djkeshawa/visp-dev/actions/runs/30686678616",
    workflowPath: ".github/workflows/test.yml"
  },
  artifacts: [
    {
      archiveMemberPath: "conformance-fixtures-darwin-arm64-node24.json",
      artifactDigestSha256: "cc154da53ce76ba48c2522d968935830d95c7cd03899b95ee9319b3c478ff115",
      artifactId: "8814222958",
      artifactName: "conformance-fixtures-macos-latest",
      artifactUrl: "https://api.github.com/repos/djkeshawa/visp-dev/actions/artifacts/8814222958",
      destinationPath: "evidence/conformance-fixtures-darwin-arm64-node24.json",
      expectedArchitecture: "arm64",
      expectedNodeMajor: 24,
      expectedOperatingSystem: "darwin",
      headSha: "7662be94de9a0c707c9ad28d64a6c1a845d163f8",
      rawFileSha256: "6ef49f5bac6826963d17eb00959d9f9256faaaa26abcbd04055274cd1b60d707",
      reportSha256: "a36dd6a8b4381ffcc14883f5ebf20373f7b834ee610720bb0fab761bd31192f1",
      workflowRunId: "30686678616"
    },
    {
      archiveMemberPath: "conformance-fixtures-linux-x64-node24.json",
      artifactDigestSha256: "d8892c09b9e3731af5dfff1b690baddd20e5ea8565883faaa1f446dd11cee371",
      artifactId: "8814234301",
      artifactName: "conformance-fixtures-ubuntu-latest",
      artifactUrl: "https://api.github.com/repos/djkeshawa/visp-dev/actions/artifacts/8814234301",
      destinationPath: "evidence/conformance-fixtures-linux-x64-node24.json",
      expectedArchitecture: "x64",
      expectedNodeMajor: 24,
      expectedOperatingSystem: "linux",
      headSha: "7662be94de9a0c707c9ad28d64a6c1a845d163f8",
      rawFileSha256: "fd0981a48dcb5a3fd49d39b37908dfa33c7f3adea147e4cf20935982d968ebb0",
      reportSha256: "b5c886697ee7a0a417ef3d3a2dc78c9ae391eb0243e8b28698452ee007695899",
      workflowRunId: "30686678616"
    }
  ]
});

export const D107_PHASE_6_EVIDENCE = deepFreeze({
  fileSha256: "df7b4a5a6f01d34f09810d47d720dc4deb587e01293d0df392e9084e184fad7c",
  reportSha256: "ac37ea8bfc205628f9c01e819637c4ecf57f72c1457eafcc18ef43ff25e1f4e7",
  runIdentity: {
    provider: "local",
    runAttempt: "1",
    runId: "c1-d107-phase6-20260801"
  }
});

export function verifyReleaseCandidateReport(report) {
  plainObject(report, "Release candidate report");

  // Two report generations, and the distinction is load-bearing:
  //   v1 / assembled_not_published   — a candidate for a pair NOT yet published.
  //   v2 / released_and_byte_identical — evidence ABOUT a published pair, where
  //        every artifact was proven byte-identical to what the registry serves.
  // A v2 report must never claim the v1 status, and vice versa: that pairing is
  // the whole reason a published pair can be described without lying about it.
  const released =
    report.schemaVersion === "visp.release-candidate.v2" &&
    report.status === "released_and_byte_identical";
  const candidate =
    report.schemaVersion === "visp.release-candidate.v1" &&
    report.status === "assembled_not_published";

  if (!released && !candidate) {
    throw new Error("Release candidate report identity is invalid");
  }

  verifyHash(report.reportSha256, "Release candidate report hash");
  const unhashed = structuredClone(report);

  delete unhashed.reportSha256;
  if (report.reportSha256 !== sha256Hex(canonicalStringify(unhashed))) {
    throw new Error("Release candidate report hash does not match its content");
  }

  if (!Array.isArray(report.artifacts) || report.artifacts.length === 0) {
    throw new Error("Release candidate report has no artifacts");
  }
  const names = new Set();
  for (const artifact of report.artifacts) {
    exactKeys(
      artifact,
      released
        ? [
            "byteIdenticalOnRepack",
            "byteIdenticalToRegistry",
            "commit",
            "name",
            "registryTarballSha256",
            "tarballSha256",
            "tree",
            "version"
          ]
        : ["byteIdenticalOnRepack", "commit", "name", "tarballSha256", "tree", "version"],
      "Release candidate artifact"
    );
    verifyPackageIdentity(
      {
        commit: artifact.commit,
        name: artifact.name,
        tarballSha256: artifact.tarballSha256,
        tree: artifact.tree,
        version: artifact.version
      },
      `Release candidate artifact ${artifact.name}`
    );
    if (artifact.byteIdenticalOnRepack !== true || names.has(artifact.name)) {
      throw new Error("Release candidate artifact identity is contradictory");
    }
    if (released) {
      // The claim and the numbers must agree. A report asserting byte-identity
      // whose two hashes differ is worse than no report: it launders a
      // divergence into an attestation.
      verifyHash(artifact.registryTarballSha256, `Registry tarball hash for ${artifact.name}`);
      if (
        artifact.byteIdenticalToRegistry !== true ||
        artifact.registryTarballSha256 !== artifact.tarballSha256
      ) {
        throw new Error(
          `Released artifact ${artifact.name} claims registry byte-identity that its own hashes contradict`
        );
      }
    }
    names.add(artifact.name);
  }

  return true;
}

export function createPlatformProvenanceReport(input) {
  const report = {
    schemaVersion: "visp.platform-evidence-provenance.v1",
    note: "Captured provenance binding exact unmodified platform-report members to one GitHub Actions run. The self-hash protects this captured attestation; it is not proof of GitHub authenticity.",
    run: structuredClone(input.run),
    artifacts: [...input.artifacts].sort((left, right) =>
      left.destinationPath.localeCompare(right.destinationPath)
    )
  };

  report.reportSha256 = sha256Hex(canonicalStringify(report));
  verifyPlatformProvenanceReport(report);

  return JSON.parse(canonicalStringify(report));
}

export function verifyPlatformProvenanceReport(report) {
  exactKeys(
    report,
    ["artifacts", "note", "reportSha256", "run", "schemaVersion"],
    "Platform provenance report"
  );
  if (
    report.schemaVersion !== "visp.platform-evidence-provenance.v1" ||
    report.note !==
      "Captured provenance binding exact unmodified platform-report members to one GitHub Actions run. The self-hash protects this captured attestation; it is not proof of GitHub authenticity."
  ) {
    throw new Error("Platform provenance report identity is invalid");
  }
  verifyHash(report.reportSha256, "Platform provenance report hash");
  const unhashed = structuredClone(report);

  delete unhashed.reportSha256;
  if (report.reportSha256 !== sha256Hex(canonicalStringify(unhashed))) {
    throw new Error("Platform provenance report hash does not match its content");
  }
  exactKeys(
    report.run,
    [
      "conclusion",
      "event",
      "headSha",
      "provider",
      "repository",
      "runAttempt",
      "runId",
      "url",
      "workflowPath"
    ],
    "Platform provenance run"
  );
  verifyRunIdentity(
    {
      provider: report.run.provider,
      runAttempt: report.run.runAttempt,
      runId: report.run.runId
    },
    "Platform provenance run identity"
  );
  verifyCommit(report.run.headSha, "Platform provenance run head SHA");
  if (
    report.run.provider !== "github-actions" ||
    report.run.conclusion !== "success" ||
    report.run.event !== "push" ||
    report.run.workflowPath !== ".github/workflows/test.yml" ||
    report.run.repository !== "djkeshawa/visp-dev" ||
    report.run.url !== `https://github.com/djkeshawa/visp-dev/actions/runs/${report.run.runId}`
  ) {
    throw new Error("Platform provenance run identity is invalid");
  }

  if (!Array.isArray(report.artifacts) || report.artifacts.length !== 2) {
    throw new Error("Platform provenance must contain exactly two artifacts");
  }
  const paths = new Set();
  const ids = new Set();
  for (const artifact of report.artifacts) {
    exactKeys(
      artifact,
      [
        "artifactDigestSha256",
        "artifactId",
        "artifactName",
        "artifactUrl",
        "archiveMemberPath",
        "destinationPath",
        "expectedArchitecture",
        "expectedNodeMajor",
        "expectedOperatingSystem",
        "headSha",
        "rawFileSha256",
        "reportSha256",
        "workflowRunId"
      ],
      "Platform provenance artifact"
    );
    verifyHash(artifact.artifactDigestSha256, "Platform artifact digest");
    verifyHash(artifact.rawFileSha256, "Platform report file hash");
    verifyHash(artifact.reportSha256, "Platform inner report hash");
    verifyCommit(artifact.headSha, "Platform artifact head SHA");
    const expected =
      artifact.destinationPath === PLATFORM_PATHS.linux
        ? {
            artifactName: "conformance-fixtures-ubuntu-latest",
            architecture: "x64",
            member: "conformance-fixtures-linux-x64-node24.json",
            operatingSystem: "linux"
          }
        : artifact.destinationPath === PLATFORM_PATHS.darwin
          ? {
              artifactName: "conformance-fixtures-macos-latest",
              architecture: "arm64",
              member: "conformance-fixtures-darwin-arm64-node24.json",
              operatingSystem: "darwin"
            }
          : null;
    if (
      typeof artifact.artifactId !== "string" ||
      !/^[1-9][0-9]*$/u.test(artifact.artifactId) ||
      artifact.artifactUrl !==
        `https://api.github.com/repos/djkeshawa/visp-dev/actions/artifacts/${artifact.artifactId}` ||
      expected === null ||
      artifact.artifactName !== expected.artifactName ||
      artifact.archiveMemberPath !== expected.member ||
      artifact.expectedOperatingSystem !== expected.operatingSystem ||
      artifact.expectedArchitecture !== expected.architecture ||
      artifact.expectedNodeMajor !== 24 ||
      artifact.workflowRunId !== report.run.runId ||
      artifact.headSha !== report.run.headSha ||
      paths.has(artifact.destinationPath) ||
      ids.has(artifact.artifactId)
    ) {
      throw new Error("Platform provenance artifact identity is invalid");
    }
    paths.add(artifact.destinationPath);
    ids.add(artifact.artifactId);
  }

  if (paths.size !== 2) throw new Error("Platform provenance omits a required platform");

  return true;
}

/**
 * A provenance report is only "reviewed" if it matches a run a human actually
 * reviewed. The pin is a parameter so a later review can be recorded, but it
 * DEFAULTS to the D-107 set: an omitted argument can never mean "accept
 * anything", which is the failure mode that would quietly retire this control.
 */
export function verifyReviewedPlatformProvenanceReport(report, reviewedProvenance = D107_PLATFORM_PROVENANCE) {
  verifyPlatformProvenanceReport(report);
  if (
    canonicalStringify({ artifacts: report.artifacts, run: report.run }) !==
    canonicalStringify(reviewedProvenance)
  ) {
    throw new Error("Platform provenance does not match the reviewed D-107 run and artifacts");
  }

  return true;
}

function candidatePackages(report) {
  return Object.fromEntries(
    report.artifacts.map((artifact) => [
      artifact.name === "visp-kit" ? "kit" : artifact.name === "visp-hyper-agent" ? "hyper" : artifact.name,
      {
        commit: artifact.commit,
        name: artifact.name,
        tarballSha256: artifact.tarballSha256,
        tree: artifact.tree,
        version: artifact.version
      }
    ])
  );
}

function addIssue(issues, code, report, detail) {
  issues.push({ code, detail, report });
}

function verifyInto(issues, reportName, report, verifier) {
  if (report === null || report === undefined) {
    addIssue(issues, "evidence_missing", reportName, `${reportName} is missing`);
    return false;
  }
  try {
    verifier(report);
    return true;
  } catch (error) {
    addIssue(
      issues,
      "verification_failed",
      reportName,
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

function platformIdentity({ report, path, provenance, fileSha256, issues }) {
  const artifact = provenance?.artifacts?.find((entry) => entry.destinationPath === path);
  if (artifact === undefined) {
    addIssue(issues, "provenance_missing", path, "Platform report has no exact provenance binding");
    return null;
  }
  if (
    report.reportSha256 !== artifact.reportSha256 ||
    fileSha256 !== artifact.rawFileSha256 ||
    report.environment.operatingSystem !== artifact.expectedOperatingSystem ||
    report.environment.architecture !== artifact.expectedArchitecture ||
    Number.parseInt(report.environment.node.replace(/^v/u, ""), 10) !== artifact.expectedNodeMajor
  ) {
    addIssue(
      issues,
      "provenance_report_mismatch",
      path,
      "Legacy report bytes or observations do not match their run provenance"
    );
    return null;
  }

  if (report.schemaVersion === "visp.conformance-fixtures.v2") return report.packages;

  return {
    kit: {
      commit: report.packages.kit.commit,
      tarballSha256: report.packages.kit.tarballSha256
    },
    hyper: {
      commit: report.packages.hyper.commit,
      tarballSha256: report.packages.hyper.tarballSha256
    }
  };
}

function exactPlatformPackageAnchors(observed, expected) {
  return ["kit", "hyper"].every(
    (id) =>
      observed?.[id]?.commit === expected[id].commit &&
      observed?.[id]?.tarballSha256 === expected[id].tarballSha256
  );
}

/**
 * The reviewed-evidence pins.
 *
 * These exist to stop an arbitrary CI run self-certifying: a human reviewed one
 * specific run and one specific compatibility report, and froze them. That
 * control is real and is kept. What changes here is only that the pins are
 * DATA rather than module constants — previously the evaluator could validate
 * exactly one historical pair for all time, so the product could never
 * recommend anything again without a code change. A new pair now needs a
 * recorded review, which is the intended cost, rather than an edit to this
 * file, which was an accident of implementation.
 */
export const D107_REVIEWED = Object.freeze({
  packages: D107_PACKAGES,
  platformProvenance: D107_PLATFORM_PROVENANCE,
  phase6Evidence: D107_PHASE_6_EVIDENCE
});

export function evaluateReleaseEvidence(input) {
  const reviewed = input.reviewed ?? D107_REVIEWED;
  const reviewedPackages = reviewed.packages;
  const reviewedProvenance = reviewed.platformProvenance;
  const reviewedPairEvidence = reviewed.phase6Evidence;
  const issues = [];
  const valid = {
    candidate: verifyInto(issues, "candidate", input.candidate, verifyReleaseCandidateReport),
    phase6: verifyInto(issues, "phase6", input.phase6, verifyPhase6CompatibilityReport),
    linux: verifyInto(issues, "linux", input.linux, verifyConformanceFixtureReport),
    darwin: verifyInto(issues, "darwin", input.darwin, verifyConformanceFixtureReport),
    provenance: verifyInto(
      issues,
      "platformProvenance",
      input.platformProvenance,
      verifyPlatformProvenanceReport
    )
  };

  const identities = {
    candidate: valid.candidate ? candidatePackages(input.candidate) : null,
    phase6: valid.phase6
      ? {
          kit: input.phase6.packages.kitFixed,
          hyper: input.phase6.packages.hyperCurrent
        }
      : null,
    linux: valid.linux
      ? platformIdentity({
          report: input.linux,
          path: PLATFORM_PATHS.linux,
          provenance: valid.provenance ? input.platformProvenance : null,
          fileSha256: input.linuxFileSha256,
          issues
        })
      : null,
    darwin: valid.darwin
      ? platformIdentity({
          report: input.darwin,
          path: PLATFORM_PATHS.darwin,
          provenance: valid.provenance ? input.platformProvenance : null,
          fileSha256: input.darwinFileSha256,
          issues
        })
      : null
  };

  if (
    valid.provenance &&
    canonicalStringify({
      artifacts: input.platformProvenance.artifacts,
      run: input.platformProvenance.run
    }) !== canonicalStringify(reviewedProvenance)
  ) {
    addIssue(
      issues,
      "provenance_not_reviewed",
      "platformProvenance",
      "Platform provenance does not match the reviewed D-107 GitHub run and exact artifact members"
    );
  }

  if (valid.phase6 && input.phase6.producer !== "packed-runner") {
    addIssue(
      issues,
      "producer_not_authoritative",
      "phase6",
      "Phase 6 eligibility requires the packed runner, not a synthetic constructor"
    );
  }
  if (
    valid.phase6 &&
    (input.phase6FileSha256 !== reviewedPairEvidence.fileSha256 ||
      input.phase6.reportSha256 !== reviewedPairEvidence.reportSha256 ||
      canonicalStringify(input.phase6.runIdentity) !==
        canonicalStringify(reviewedPairEvidence.runIdentity))
  ) {
    addIssue(
      issues,
      "phase6_not_reviewed",
      "phase6",
      "Phase 6 does not match the reviewed packed report bytes and local run identity"
    );
  }

  for (const [reportName, report] of [["linux", input.linux], ["darwin", input.darwin]]) {
    if (
      valid[reportName] &&
      !exactPlatformPackageAnchors(report.packages, reviewedPackages)
    ) {
      addIssue(
        issues,
        "package_identity_mismatch",
        reportName,
        `${reportName} raw commit and tarball anchors do not uniquely match D-107`
      );
    }
  }

  if (identities.candidate !== null && Object.keys(identities.candidate).length !== 2) {
    addIssue(issues, "package_identity_mismatch", "candidate", "Candidate is not exactly Kit and Hyper");
  }
  for (const [reportName, packages] of Object.entries({
    candidate: identities.candidate,
    phase6: identities.phase6
  })) {
    if (packages === null) continue;
    for (const id of ["kit", "hyper"]) {
      if (!packageIdentityEqual(packages[id], reviewedPackages[id])) {
        addIssue(
          issues,
          "package_identity_mismatch",
          reportName,
          `${reportName} ${id} does not match the exact D-107 identity`
        );
      }
    }
  }

  const fullIdentitiesAgree = [identities.candidate, identities.phase6].every(
    (packages) =>
      packages !== null &&
      ["kit", "hyper"].every((id) => packageIdentityEqual(packages[id], reviewedPackages[id]))
  );
  const platformAnchorsAgree = [identities.linux, identities.darwin].every(
    (packages) => packages !== null && exactPlatformPackageAnchors(packages, reviewedPackages)
  );
  const resolvedPackages =
    fullIdentitiesAgree && platformAnchorsAgree ? structuredClone(D107_PACKAGES) : null;

  for (const [reportName, report] of [["linux", input.linux], ["darwin", input.darwin]]) {
    if (!valid[reportName]) continue;
    const allPass =
      report.fixtures.length === REQUIRED_FIXTURES.length &&
      report.fixtures.every((entry) => entry.status === "pass") &&
      report.summary.failed === 0 &&
      report.summary.knownDefects === 0 &&
      report.summary.passed === REQUIRED_FIXTURES.length &&
      report.summary.ran === REQUIRED_FIXTURES.length &&
      report.summary.required === REQUIRED_FIXTURES.length;
    if (!allPass) {
      addIssue(
        issues,
        "fixture_failure",
        reportName,
        `${reportName} must record exactly ${REQUIRED_FIXTURES.length} required fixtures, all passing`
      );
    }
  }

  if (valid.linux && (input.linux.environment.operatingSystem !== "linux" || input.linux.environment.architecture !== "x64")) {
    addIssue(issues, "platform_mismatch", "linux", "Linux evidence must be linux/x64");
  }
  if (valid.darwin && (input.darwin.environment.operatingSystem !== "darwin" || input.darwin.environment.architecture !== "arm64")) {
    addIssue(issues, "platform_mismatch", "darwin", "macOS evidence must be darwin/arm64");
  }
  for (const [reportName, report] of [["linux", input.linux], ["darwin", input.darwin]]) {
    if (valid[reportName] && !/^v24(?:\.|$)/u.test(report.environment.node)) {
      addIssue(issues, "platform_mismatch", reportName, `${reportName} evidence must use Node 24`);
    }
  }

  if (valid.linux && valid.darwin && valid.provenance) {
    const runIdentity = {
      provider: input.platformProvenance.run.provider,
      runAttempt: input.platformProvenance.run.runAttempt,
      runId: input.platformProvenance.run.runId
    };
    const linuxRunIdentity =
      input.linux.schemaVersion === "visp.conformance-fixtures.v2"
        ? input.linux.runIdentity
        : runIdentity;
    const darwinRunIdentity =
      input.darwin.schemaVersion === "visp.conformance-fixtures.v2"
        ? input.darwin.runIdentity
        : runIdentity;
    if (
      canonicalStringify(linuxRunIdentity) !== canonicalStringify(runIdentity) ||
      canonicalStringify(darwinRunIdentity) !== canonicalStringify(runIdentity) ||
      runIdentity.provider !== "github-actions"
    ) {
      addIssue(
        issues,
        "run_identity_mismatch",
        "platforms",
        "Linux and macOS evidence must share one GitHub Actions run and attempt"
      );
    }
  }

  const sortedIssues = issues.sort((left, right) =>
    `${left.report}:${left.code}:${left.detail}`.localeCompare(
      `${right.report}:${right.code}:${right.detail}`
    )
  );

  return {
    eligible: sortedIssues.length === 0,
    expectedPackages: structuredClone(D107_PACKAGES),
    identities,
    issues: sortedIssues,
    platformRunIdentity: valid.provenance
      ? {
          provider: input.platformProvenance.run.provider,
          runAttempt: input.platformProvenance.run.runAttempt,
          runId: input.platformProvenance.run.runId
        }
      : null,
    resolvedPackages
  };
}
