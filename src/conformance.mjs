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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every family Phase 6 requires. Declared independently of what happens to
 * exist, so adding evidence closes a gap rather than defining one.
 */
export const REQUIRED_FAMILIES = [
  {
    id: "protocol",
    description: "WorkflowAction negotiation and schema-hash agreement across versions",
    evidence: ["evidence/phase-3-packed-linux-x64-node24.json", "evidence/phase-4-pair-linux-x64-node24.json"]
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
      "evidence/release-candidate-linux-x64-node24.json"
    ]
  },
  {
    id: "hook",
    description: "Git and CI hook enforcement remains authoritative when native hooks exist",
    evidence: []
  },
  {
    id: "operating_system",
    description: "Packed installation verified on macOS and Windows, not only Linux",
    evidence: []
  },
  {
    id: "security",
    description: "Path traversal, command injection, and package-allowlist fixtures against packed binaries",
    evidence: []
  },
  {
    id: "failure_mode",
    description: "Missing binary, unsupported host version, corrupted artifact, and interrupted run",
    evidence: []
  }
];

async function loadReport(relative) {
  try {
    return JSON.parse(await readFile(path.join(root, relative), "utf8"));
  } catch {
    return null;
  }
}

export async function runConformance() {
  const candidate = await loadReport("evidence/release-candidate-linux-x64-node24.json");
  const families = [];

  for (const family of REQUIRED_FAMILIES) {
    const reports = [];

    for (const relative of family.evidence) {
      const report = await loadReport(relative);

      reports.push({
        path: relative,
        present: report !== null,
        // Every evidence report in this repository is canonical and self-hashed,
        // so presence and integrity can be checked without re-running anything.
        reportSha256: report?.reportSha256 ?? null
      });
    }

    const covered = family.evidence.length > 0 && reports.every((entry) => entry.present);

    families.push({
      id: family.id,
      description: family.description,
      status: family.evidence.length === 0 ? "no_evidence" : covered ? "covered" : "evidence_missing",
      reports
    });
  }

  const covered = families.filter((family) => family.status === "covered");
  const gaps = families.filter((family) => family.status !== "covered");

  const report = {
    schemaVersion: "visp.conformance.v1",
    note: "Families are declared independently of the evidence that happens to exist, so a gap reports as a gap.",
    candidate:
      candidate === null
        ? null
        : {
            status: candidate.status,
            artifacts: candidate.artifacts.map((artifact) => ({
              name: artifact.name,
              version: artifact.version,
              commit: artifact.commit,
              tarballSha256: artifact.tarballSha256
            }))
          },
    families,
    summary: {
      required: families.length,
      covered: covered.length,
      gaps: gaps.length,
      gapIds: gaps.map((family) => family.id).sort()
    },
    // Conformance is not "everything passed". It is "these families are proven
    // and these are not", which is the only version a reader can act on.
    verdict: gaps.length === 0 ? "complete" : "partial"
  };

  report.reportSha256 = sha256Hex(canonicalStringify(report));

  return JSON.parse(canonicalStringify(report));
}

export function verifyConformanceReport(report) {
  if (report.schemaVersion !== "visp.conformance.v1") {
    throw new Error("Conformance report has an unexpected schema version.");
  }

  const unhashed = structuredClone(report);

  delete unhashed.reportSha256;

  if (report.reportSha256 !== sha256Hex(canonicalStringify(unhashed))) {
    throw new Error("Conformance report hash does not match its content.");
  }

  const declared = new Set(REQUIRED_FAMILIES.map((family) => family.id));
  const observed = new Set(report.families.map((family) => family.id));

  for (const id of declared) {
    if (!observed.has(id)) throw new Error(`Conformance report omits required family ${id}.`);
  }

  // A report claiming completeness while listing gaps is the failure this
  // verifier exists to catch.
  if (report.verdict === "complete" && report.summary.gaps > 0) {
    throw new Error("Conformance report claims completeness while reporting gaps.");
  }

  return true;
}
