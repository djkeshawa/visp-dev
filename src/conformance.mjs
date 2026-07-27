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
    evidence: ["evidence/conformance-fixtures-linux-x64-node24.json"]
  },
  {
    id: "operating_system",
    description: "Packed installation verified on macOS and Windows, not only Linux",
    // The Linux report exists; the other two are produced by the CI matrix and
    // are listed here so their absence reports as a gap rather than as silence.
    // This family cannot be closed from a Linux workstation, and pretending
    // otherwise is the failure mode this whole module is built to avoid.
    evidence: [
      "evidence/conformance-fixtures-linux-x64-node24.json",
      "evidence/conformance-fixtures-darwin-arm64-node24.json",
      "evidence/conformance-fixtures-win32-x64-node24.json"
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

    // Coverage is not health. A family can be fully evidenced and still have
    // recorded defects, and a report that showed only "covered" would hide
    // exactly the findings the evidence was gathered to expose.
    const knownDefects = [];

    for (const relative of family.evidence) {
      const report = await loadReport(relative);

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
      gapIds: gaps.map((family) => family.id).sort(),
      knownDefects: [...new Set(families.flatMap((family) => family.knownDefects))].sort()
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
