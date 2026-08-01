/**
 * The engineering conformance suite.
 *
 * Aggregates every committed evidence report into one verdict against the
 * assembled release candidate, and — more usefully — states which fixture
 * families have no evidence at all.
 *
 * A conformance report that only lists passes is a marketing artifact. The
 * families below are declared first and matched against evidence second, so a
 * gap shows up as a gap rather than as an absence nobody notices.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalStringify, sha256Hex } from "./compatibility-lab.mjs";
import {
  D107_PACKAGES,
  D107_PHASE_6_EVIDENCE,
  D107_PLATFORM_PROVENANCE,
  evaluateReleaseEvidence
} from "./release-evidence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_NOTE =
  "Families are declared independently of the evidence that happens to exist, so a gap reports as a gap.";

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  if (canonicalStringify(Object.keys(value).sort()) !== canonicalStringify([...keys].sort())) {
    throw new Error(`${label} has an unexpected field set.`);
  }
}

function verifyReportHash(report) {
  if (typeof report.reportSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(report.reportSha256)) {
    throw new Error("Conformance report hash is invalid.");
  }
  const unhashed = structuredClone(report);

  delete unhashed.reportSha256;
  if (report.reportSha256 !== sha256Hex(canonicalStringify(unhashed))) {
    throw new Error("Conformance report hash does not match its content.");
  }
}

function verifyFamilyEnvelope(report) {
  if (!Array.isArray(report.families) || report.families.length !== REQUIRED_FAMILIES.length) {
    throw new Error("Conformance report has an unexpected family count.");
  }
  const declared = new Set(REQUIRED_FAMILIES.map((family) => family.id));
  const observed = new Set();

  for (const family of report.families) {
    exactKeys(
      family,
      ["description", "id", "knownDefects", "reports", "status"],
      "Conformance family"
    );
    if (
      typeof family.id !== "string" ||
      !declared.has(family.id) ||
      observed.has(family.id) ||
      typeof family.description !== "string" ||
      family.description.length === 0 ||
      !["covered", "evidence_invalid", "evidence_missing", "no_evidence"].includes(family.status) ||
      !Array.isArray(family.knownDefects) ||
      family.knownDefects.some((id) => typeof id !== "string" || id.length === 0) ||
      !Array.isArray(family.reports)
    ) {
      throw new Error("Conformance family identity is invalid.");
    }
    observed.add(family.id);
    for (const evidence of family.reports) {
      exactKeys(evidence, ["path", "present", "reportSha256"], "Conformance family report");
      if (
        typeof evidence.path !== "string" ||
        evidence.path.length === 0 ||
        typeof evidence.present !== "boolean" ||
        (evidence.present
          ? typeof evidence.reportSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(evidence.reportSha256)
          : evidence.reportSha256 !== null)
      ) {
        throw new Error("Conformance family report identity is invalid.");
      }
    }
  }
}

function verifySummaryAndVerdict(report, releaseEligible, legacyCoverageVerdict = false) {
  exactKeys(
    report.summary,
    ["covered", "gapIds", "gaps", "knownDefects", "required"],
    "Conformance summary"
  );
  const covered = report.families.filter((family) => family.status === "covered");
  const gaps = report.families.filter((family) => family.status !== "covered");
  const knownDefects = [...new Set(report.families.flatMap((family) => family.knownDefects))].sort();
  if (
    report.summary.required !== report.families.length ||
    report.summary.covered !== covered.length ||
    report.summary.gaps !== gaps.length ||
    canonicalStringify(report.summary.gapIds) !==
      canonicalStringify(gaps.map((family) => family.id).sort()) ||
    canonicalStringify(report.summary.knownDefects) !== canonicalStringify(knownDefects)
  ) {
    throw new Error("Conformance report summary does not match its families.");
  }
  const expectedVerdict =
    gaps.length === 0 && (releaseEligible || legacyCoverageVerdict) ? "complete" : "partial";
  if (report.verdict !== expectedVerdict) {
    throw new Error("Conformance verdict does not match gaps and release eligibility.");
  }
}

/**
 * Every family Phase 6 requires. Declared independently of what happens to
 * exist, so adding evidence closes a gap rather than defining one.
 */
export const REQUIRED_FAMILIES = [
  {
    id: "protocol",
    description: "WorkflowAction negotiation and schema-hash agreement across versions",
    evidence: [
      "evidence/phase-3-packed-linux-x64-node24.json",
      "evidence/phase-4-pair-linux-x64-node24.json",
      "evidence/phase-6-pair-linux-x64-node24.json"
    ]
  },
  {
    id: "evidence",
    description: "Evidence validity: freshness, independence, and fail-closed behaviour",
    evidence: ["evidence/phase-2-packed-linux-x64-node24.json"]
  },
  {
    id: "assurance",
    description: "Assurance cases, ranked hotspots, and bound human review decisions",
    evidence: ["evidence/phase-3-packed-linux-x64-node24.json", "evidence/golden-path-linux-x64-node24.json"]
  },
  {
    id: "host",
    description: "Host capability manifests and rendered assets per supported host",
    evidence: ["evidence/phase-4-host-examples-linux-x64-node24.json"]
  },
  {
    id: "scope",
    description: "Out-of-scope changes are blocked and correction is possible",
    evidence: ["evidence/golden-path-linux-x64-node24.json"]
  },
  {
    id: "release_identity",
    description: "Artifacts identified by commit and hash; published versions are immutable",
    evidence: [
      "evidence/registry-divergence-linux-x64-node24.json",
      "evidence/release-candidate-linux-x64-node24.json",
      "evidence/phase-6-pair-linux-x64-node24.json",
      "evidence/conformance-fixtures-run-30686678616.json"
    ]
  },
  {
    id: "hook",
    description: "Git and CI hook enforcement remains authoritative when native hooks exist",
    evidence: ["evidence/conformance-fixtures-linux-x64-node24.json"]
  },
  {
    id: "operating_system",
    description: "Packed installation verified on every platform where the evidence is reproducible",
    // Linux and macOS. Windows is deliberately absent, and that is a finding
    // rather than an omission.
    //
    // The fixtures install from a snapshot that restores each blob's Git mode
    // and verifies it applied, so a 100755 file is executable in the snapshot
    // exactly as in the commit. Windows has no POSIX mode bits, so that
    // verification cannot pass there. Relaxing it would weaken every snapshot on
    // every platform to make one platform quiet, which trades real evidence for
    // the appearance of coverage.
    //
    // Windows support is therefore an open question about what evidence is
    // obtainable there, not a CI job waiting to be run. See
    // docs/platform-support.md.
    evidence: [
      "evidence/conformance-fixtures-linux-x64-node24.json",
      "evidence/conformance-fixtures-darwin-arm64-node24.json",
      "evidence/conformance-fixtures-run-30686678616.json"
    ]
  },
  {
    id: "security",
    description: "Path traversal, command injection, and package-allowlist fixtures against packed binaries",
    evidence: ["evidence/conformance-fixtures-linux-x64-node24.json"]
  },
  {
    id: "failure_mode",
    description: "Missing binary, unsupported host version, corrupted artifact, and interrupted run",
    evidence: ["evidence/conformance-fixtures-linux-x64-node24.json"]
  }
];

const platformEvidenceByPath = Object.fromEntries(
  D107_PLATFORM_PROVENANCE.artifacts.map((artifact) => [artifact.destinationPath, artifact])
);

/**
 * Closed C1 source manifest. Inner hashes bind the semantic report content;
 * raw hashes bind the exact reviewed file bytes used to build the aggregate.
 */
const REVIEWED_EVIDENCE_FILES = Object.freeze([
  {
    path: "evidence/conformance-fixtures-darwin-arm64-node24.json",
    fileSha256:
      platformEvidenceByPath["evidence/conformance-fixtures-darwin-arm64-node24.json"].rawFileSha256,
    reportSha256:
      platformEvidenceByPath["evidence/conformance-fixtures-darwin-arm64-node24.json"].reportSha256
  },
  {
    path: "evidence/conformance-fixtures-linux-x64-node24.json",
    fileSha256:
      platformEvidenceByPath["evidence/conformance-fixtures-linux-x64-node24.json"].rawFileSha256,
    reportSha256:
      platformEvidenceByPath["evidence/conformance-fixtures-linux-x64-node24.json"].reportSha256
  },
  {
    path: "evidence/conformance-fixtures-run-30686678616.json",
    fileSha256: "da0bddebf24ea289219b4d601e8ce97a9db6ab8001aafff7fecc50659cac8f12",
    reportSha256: "321ab76fc5b9e14b96dab4d28ae1fcd8763ad8535c16b2fb113c7b447a8fe52e"
  },
  {
    path: "evidence/golden-path-linux-x64-node24.json",
    fileSha256: "d5386c68d3309903ef148fd1791c8adc45208723152251b97711c254963a86e3",
    reportSha256: "82c3424d1eb20c2423812e268dd4d2478c9fcf3cb3f454e4b90755f623d547d0"
  },
  {
    path: "evidence/phase-2-packed-linux-x64-node24.json",
    fileSha256: "7fa8bbcaeb29106deb0bc721f6dc352fa94ceaf47cd5746870b67d316e2abaf6",
    reportSha256: "e34a3e4f02b060a0b4ce1d896f44c73d720a39391a2294319365af589ac1d5a0"
  },
  {
    path: "evidence/phase-3-packed-linux-x64-node24.json",
    fileSha256: "4d5c5d91a5f21a02f120538d468ae61226747cf956c3d796652822012ed30564",
    reportSha256: "29f027f0ee1efdf0147a90fff4ed25ae763a6ccd65cba409f5afb3a4fd67dd83"
  },
  {
    path: "evidence/phase-4-host-examples-linux-x64-node24.json",
    fileSha256: "6135f802d86cba0298b6c5a0a10baa72663a3f9e8544e010e6b1e4992433b8da",
    reportSha256: "e2695e37cd1d18a3a1c6a24f9177633ebcebfb311eff91395f152d6ed0344d53"
  },
  {
    path: "evidence/phase-4-pair-linux-x64-node24.json",
    fileSha256: "d3929b181feaf0d0c6559fcd733c9dca97693c470c76944944f315ddb6964044",
    reportSha256: "593f49385b22e3775a328cd83e87f159595cde6174c07006de9f43414ded3252"
  },
  {
    path: "evidence/phase-6-pair-linux-x64-node24.json",
    fileSha256: D107_PHASE_6_EVIDENCE.fileSha256,
    reportSha256: D107_PHASE_6_EVIDENCE.reportSha256
  },
  {
    path: "evidence/registry-divergence-linux-x64-node24.json",
    fileSha256: "df2491be9cb8b56a2be90cd0bb882284f54e89199d24905ecfa476b9b3ef9416",
    reportSha256: "04112dc6ed2c637e093d843bb59100c06e1eb57d10bdadb320e7fb3ba65d5d45"
  },
  {
    path: "evidence/release-candidate-linux-x64-node24.json",
    fileSha256: "c4313e2d790a44a759afca8da5d1442bd1f669cbd91793894bcfae492e34751a",
    reportSha256: "074f01f848d72543ca951766f92abe7e52295135e543b7915da975b85128717e"
  }
]);

function exactPathSet(actual, expected, label) {
  if (
    actual.length !== expected.length ||
    new Set(actual).size !== actual.length ||
    canonicalStringify([...actual].sort()) !== canonicalStringify([...expected].sort())
  ) {
    throw new Error(`${label} does not match its exact evidence path set.`);
  }
}

function verifyC1EvidenceManifest(report) {
  if (!Array.isArray(report.evidenceFiles)) {
    throw new Error("C1 conformance evidenceFiles must be an array.");
  }

  const reviewedByPath = new Map(REVIEWED_EVIDENCE_FILES.map((entry) => [entry.path, entry]));

  exactPathSet(
    report.evidenceFiles.map((entry) => entry?.path),
    REVIEWED_EVIDENCE_FILES.map((entry) => entry.path),
    "C1 conformance source manifest"
  );
  for (const evidence of report.evidenceFiles) {
    exactKeys(
      evidence,
      ["fileSha256", "path", "present", "reportSha256"],
      "C1 conformance source manifest entry"
    );
    const reviewed = reviewedByPath.get(evidence.path);

    if (
      typeof evidence.present !== "boolean" ||
      (evidence.present === false &&
        (evidence.fileSha256 !== null || evidence.reportSha256 !== null))
    ) {
      throw new Error("C1 conformance source manifest entry is invalid.");
    }
    if (evidence.present) {
      if (evidence.fileSha256 !== reviewed.fileSha256) {
        throw new Error(
          `C1 conformance evidence ${evidence.path} does not match its reviewed raw-file hash.`
        );
      }
      if (evidence.reportSha256 !== reviewed.reportSha256) {
        throw new Error(
          `C1 conformance evidence ${evidence.path} does not match its reviewed inner report hash.`
        );
      }
    }
  }

  const manifestByPath = new Map(report.evidenceFiles.map((entry) => [entry.path, entry]));
  const requiredById = new Map(REQUIRED_FAMILIES.map((family) => [family.id, family]));

  for (const family of report.families) {
    const required = requiredById.get(family.id);

    if (family.description !== required.description) {
      throw new Error(`C1 conformance family ${family.id} description drifted.`);
    }
    exactPathSet(
      family.reports.map((entry) => entry.path),
      required.evidence,
      `C1 conformance family ${family.id}`
    );
    const hasMissingEvidence = family.reports.some((entry) => entry.present === false);

    if (hasMissingEvidence !== (family.status === "evidence_missing")) {
      throw new Error(
        `C1 conformance family ${family.id} status contradicts its evidence presence.`
      );
    }
    for (const evidence of family.reports) {
      const reviewed = reviewedByPath.get(evidence.path);
      const source = manifestByPath.get(evidence.path);

      if (evidence.present && evidence.reportSha256 !== reviewed.reportSha256) {
        throw new Error(
          `C1 conformance evidence ${evidence.path} does not match its reviewed inner report hash.`
        );
      }
      if (
        evidence.present !== source.present ||
        evidence.reportSha256 !== source.reportSha256
      ) {
        throw new Error(`C1 conformance family ${family.id} contradicts its source manifest.`);
      }
    }
  }
}

async function loadReport(relative) {
  try {
    const bytes = await readFile(path.join(root, relative));

    return { fileSha256: sha256Hex(bytes), report: JSON.parse(bytes.toString("utf8")) };
  } catch {
    return null;
  }
}

export async function runConformance() {
  const loadedByPath = new Map();
  const evidenceFiles = [];

  for (const reviewed of REVIEWED_EVIDENCE_FILES) {
    const loaded = await loadReport(reviewed.path);

    loadedByPath.set(reviewed.path, loaded);
    evidenceFiles.push({
      path: reviewed.path,
      present: loaded !== null,
      fileSha256: loaded?.fileSha256 ?? null,
      reportSha256: loaded?.report.reportSha256 ?? null
    });
  }

  const evidence = {
    candidate: loadedByPath.get("evidence/release-candidate-linux-x64-node24.json"),
    darwin: loadedByPath.get("evidence/conformance-fixtures-darwin-arm64-node24.json"),
    linux: loadedByPath.get("evidence/conformance-fixtures-linux-x64-node24.json"),
    phase6: loadedByPath.get("evidence/phase-6-pair-linux-x64-node24.json"),
    platformProvenance: loadedByPath.get("evidence/conformance-fixtures-run-30686678616.json")
  };
  const releaseEvidence = evaluateReleaseEvidence({
    candidate: evidence.candidate?.report,
    darwin: evidence.darwin?.report,
    darwinFileSha256: evidence.darwin?.fileSha256,
    linux: evidence.linux?.report,
    linuxFileSha256: evidence.linux?.fileSha256,
    phase6: evidence.phase6?.report,
    phase6FileSha256: evidence.phase6?.fileSha256,
    platformProvenance: evidence.platformProvenance?.report
  });
  const candidate = evidence.candidate?.report ?? null;
  const families = [];

  for (const family of REQUIRED_FAMILIES) {
    const reports = [];

    for (const relative of family.evidence) {
      const loaded = loadedByPath.get(relative);

      reports.push({
        path: relative,
        present: loaded !== null,
        // Every evidence report in this repository is canonical and self-hashed,
        // so presence and integrity can be checked without re-running anything.
        reportSha256: loaded?.report.reportSha256 ?? null
      });
    }

    const covered = family.evidence.length > 0 && reports.every((entry) => entry.present);

    // Coverage is not health. A family can be fully evidenced and still have
    // recorded defects, and a report that showed only "covered" would hide
    // exactly the findings the evidence was gathered to expose.
    const knownDefects = [];

    for (const relative of family.evidence) {
      const report = loadedByPath.get(relative)?.report;

      for (const entry of report?.fixtures ?? []) {
        if (entry.status === "known_defect" && entry.family === family.id) {
          knownDefects.push(entry.id);
        }
      }
    }

    families.push({
      id: family.id,
      description: family.description,
      status: family.evidence.length === 0 ? "no_evidence" : covered ? "covered" : "evidence_missing",
      knownDefects: knownDefects.sort(),
      reports
    });
  }

  if (!releaseEvidence.eligible) {
    const releaseIdentity = families.find((family) => family.id === "release_identity");

    releaseIdentity.status = "evidence_invalid";
  }

  const covered = families.filter((family) => family.status === "covered");
  const gaps = families.filter((family) => family.status !== "covered");

  const report = {
    schemaVersion: "visp.conformance.v2",
    note: REPORT_NOTE,
    candidate:
      candidate === null
        ? null
        : {
            status: candidate.status,
            artifacts: candidate.artifacts.map((artifact) => ({
              name: artifact.name,
              version: artifact.version,
              commit: artifact.commit,
              tree: artifact.tree,
              tarballSha256: artifact.tarballSha256
            }))
          },
    releaseEvidence,
    evidenceFiles,
    families,
    summary: {
      required: families.length,
      covered: covered.length,
      gaps: gaps.length,
      gapIds: gaps.map((family) => family.id).sort(),
      knownDefects: [...new Set(families.flatMap((family) => family.knownDefects))].sort()
    },
    // Conformance is not "everything passed". It is "these families are proven
    // and these are not", which is the only version a reader can act on.
    verdict: gaps.length === 0 && releaseEvidence.eligible ? "complete" : "partial"
  };

  report.reportSha256 = sha256Hex(canonicalStringify(report));

  return JSON.parse(canonicalStringify(report));
}

function verifyC1ConformanceReport(report) {
  exactKeys(
    report,
    [
      "candidate",
      "evidenceFiles",
      "families",
      "note",
      "releaseEvidence",
      "reportSha256",
      "schemaVersion",
      "summary",
      "verdict"
    ],
    "C1 conformance report"
  );
  if (report.note !== REPORT_NOTE) throw new Error("C1 conformance report note is invalid.");
  verifyReportHash(report);
  verifyFamilyEnvelope(report);
  verifyC1EvidenceManifest(report);

  // A report claiming completeness while listing gaps is the failure this
  // verifier exists to catch.
  if (report.verdict === "complete" && report.summary.gaps > 0) {
    throw new Error("Conformance report claims completeness while reporting gaps.");
  }
  if (report.verdict === "complete" && report.releaseEvidence?.eligible !== true) {
    throw new Error("Conformance report claims completeness without eligible release evidence.");
  }
  const releaseEvidence = report.releaseEvidence;
  if (
    releaseEvidence === null ||
    typeof releaseEvidence !== "object" ||
    !Array.isArray(releaseEvidence.issues) ||
    releaseEvidence.eligible !== (releaseEvidence.issues.length === 0)
  ) {
    throw new Error("Conformance report release-evidence eligibility contradicts its issues.");
  }
  if (releaseEvidence.eligible) {
    if (
      canonicalStringify(releaseEvidence.expectedPackages) !== canonicalStringify(D107_PACKAGES)
    ) {
      throw new Error("Eligible release evidence does not match the frozen D-107 identity.");
    }
    const runIdentity = releaseEvidence.platformRunIdentity;
    const reviewedRunIdentity = {
      provider: D107_PLATFORM_PROVENANCE.run.provider,
      runAttempt: D107_PLATFORM_PROVENANCE.run.runAttempt,
      runId: D107_PLATFORM_PROVENANCE.run.runId
    };
    if (
      runIdentity === null ||
      canonicalStringify(Object.keys(runIdentity ?? {}).sort()) !==
        canonicalStringify(["provider", "runAttempt", "runId"]) ||
      runIdentity.provider !== "github-actions" ||
      !/^[1-9][0-9]*$/u.test(runIdentity.runId) ||
      !/^[1-9][0-9]*$/u.test(runIdentity.runAttempt) ||
      canonicalStringify(runIdentity) !== canonicalStringify(reviewedRunIdentity)
    ) {
      throw new Error("Eligible release evidence omits the platform run identity.");
    }
    for (const reportName of ["candidate", "phase6"]) {
      if (
        canonicalStringify(releaseEvidence.identities?.[reportName]) !==
        canonicalStringify(releaseEvidence.expectedPackages)
      ) {
        throw new Error(`Eligible release evidence has incoherent ${reportName} identity.`);
      }
    }
    for (const reportName of ["linux", "darwin"]) {
      for (const id of ["kit", "hyper"]) {
        const observed = releaseEvidence.identities?.[reportName]?.[id];
        const expected = releaseEvidence.expectedPackages?.[id];
        if (
          observed?.commit !== expected?.commit ||
          observed?.tarballSha256 !== expected?.tarballSha256
        ) {
          throw new Error(`Eligible release evidence has incoherent ${reportName} anchors.`);
        }
      }
    }
    if (
      canonicalStringify(releaseEvidence.resolvedPackages) !==
      canonicalStringify(releaseEvidence.expectedPackages)
    ) {
      throw new Error("Eligible release evidence does not resolve one full package identity.");
    }
    const candidateArtifacts = report.candidate?.artifacts;
    if (
      !Array.isArray(candidateArtifacts) ||
      candidateArtifacts.length !== 2 ||
      canonicalStringify(candidateArtifacts.map((artifact) => artifact.name).sort()) !==
        canonicalStringify(["visp-hyper-agent", "visp-kit"])
    ) {
      throw new Error("Conformance candidate must contain exactly one Kit and one Hyper artifact.");
    }
    const candidate = Object.fromEntries(
      candidateArtifacts.map((artifact) => [
        artifact.name === "visp-kit" ? "kit" : "hyper",
        {
          commit: artifact.commit,
          name: artifact.name,
          tarballSha256: artifact.tarballSha256,
          tree: artifact.tree,
          version: artifact.version
        }
      ])
    );
    if (canonicalStringify(candidate) !== canonicalStringify(releaseEvidence.expectedPackages)) {
      throw new Error("Conformance candidate contradicts eligible release evidence.");
    }
  }
  verifySummaryAndVerdict(report, releaseEvidence.eligible);

  return true;
}

function verifyLegacyConformanceReport(report) {
  exactKeys(
    report,
    ["candidate", "families", "note", "reportSha256", "schemaVersion", "summary", "verdict"],
    "Legacy conformance report"
  );
  if (report.note !== REPORT_NOTE) throw new Error("Legacy conformance report note is invalid.");
  verifyReportHash(report);
  verifyFamilyEnvelope(report);
  exactKeys(report.candidate, ["artifacts", "status"], "Legacy conformance candidate");
  if (
    report.candidate.status !== "assembled_not_published" ||
    !Array.isArray(report.candidate.artifacts) ||
    report.candidate.artifacts.length !== 2 ||
    canonicalStringify(report.candidate.artifacts.map((artifact) => artifact.name).sort()) !==
      canonicalStringify(["visp-hyper-agent", "visp-kit"])
  ) {
    throw new Error("Legacy conformance candidate identity is invalid.");
  }
  for (const artifact of report.candidate.artifacts) {
    exactKeys(
      artifact,
      ["commit", "name", "tarballSha256", "version"],
      "Legacy conformance candidate artifact"
    );
    if (
      !/^[0-9a-f]{40}$/u.test(artifact.commit) ||
      !/^[0-9a-f]{64}$/u.test(artifact.tarballSha256) ||
      typeof artifact.version !== "string" ||
      artifact.version.length === 0
    ) {
      throw new Error("Legacy conformance candidate artifact identity is invalid.");
    }
  }

  // v1 predates the C1 release-evidence contract. It can verify historical
  // integrity, but it can never carry or grant C1 release eligibility.
  verifySummaryAndVerdict(report, false, true);
  return true;
}

export function verifyConformanceReport(report) {
  if (report?.schemaVersion === "visp.conformance.v1") {
    return verifyLegacyConformanceReport(report);
  }
  if (report?.schemaVersion === "visp.conformance.v2") {
    return verifyC1ConformanceReport(report);
  }
  throw new Error("Conformance report has an unexpected schema version.");
}
