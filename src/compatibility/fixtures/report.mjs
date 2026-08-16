/**
 * The fixture report and its verifier.
 *
 * The failure this verifier exists to catch is a summary that reads clean over
 * fixtures that recorded defects. The summary is therefore RECOMPUTED from the
 * fixtures and compared, and the required-fixture list is checked against the
 * declared constant rather than against whatever the report happens to contain
 * — so an omission cannot be laundered by rehashing.
 *
 * `v1` reports are still accepted for verification. They carry a two-field
 * package identity instead of the full five, which is exactly why `v2` exists;
 * refusing to read them would discard evidence rather than describe its limits.
 */
import { canonicalStringify, sha256Hex } from "../../platform/canonical-json.mjs";
import { exactKeys } from "../../platform/shape.mjs";
import {
  packageIdentityFromPacked,
  verifyPackageIdentity,
  verifyRunIdentity,
} from "../engine/package-record.mjs";
import { REQUIRED_FIXTURES } from "./families.mjs";

const SCHEMA_VERSION = "visp.conformance-fixtures.v2";
const LEGACY_SCHEMA_VERSION = "visp.conformance-fixtures.v1";
const NOTE =
  "Fixtures run against packed, installed binaries. A fixture that observes a defect reports known_defect, never pass.";

export function createConformanceFixtureReport(input) {
  const byStatus = (status) => input.fixtures.filter((entry) => entry.status === status);
  const report = {
    schemaVersion: SCHEMA_VERSION,
    note: NOTE,
    environment: input.environment,
    packages: {
      kit: packageIdentityFromPacked(input.packages.kit, "Conformance fixture Kit identity"),
      hyper: packageIdentityFromPacked(input.packages.hyper, "Conformance fixture Hyper identity"),
    },
    runIdentity: structuredClone(input.runIdentity),
    fixtures: [...input.fixtures].sort((left, right) => left.id.localeCompare(right.id)),
    summary: {
      required: REQUIRED_FIXTURES.length,
      ran: input.fixtures.length,
      passed: byStatus("pass").length,
      knownDefects: byStatus("known_defect").length,
      failed: byStatus("fail").length,
      knownDefectIds: byStatus("known_defect").map((entry) => entry.id).sort(),
      failedIds: byStatus("fail").map((entry) => entry.id).sort(),
    },
    // A family counts as covered when every fixture in it ran — including the
    // ones that found something wrong, because a recorded defect is evidence
    // and an unrun fixture is not.
    familiesCovered: [...new Set(input.fixtures.map((entry) => entry.family))].sort(),
  };

  report.reportSha256 = sha256Hex(canonicalStringify(report));
  verifyConformanceFixtureReport(report);
  return JSON.parse(canonicalStringify(report));
}

function verifyIdentitySection(report) {
  if (report.schemaVersion === SCHEMA_VERSION) {
    exactKeys(
      report,
      [
        "environment",
        "familiesCovered",
        "fixtures",
        "note",
        "packages",
        "reportSha256",
        "runIdentity",
        "schemaVersion",
        "summary",
      ],
      "Conformance fixture report",
    );
    exactKeys(report.packages, ["hyper", "kit"], "Conformance fixture packages");
    verifyPackageIdentity(report.packages.kit, "Conformance fixture Kit identity");
    verifyPackageIdentity(report.packages.hyper, "Conformance fixture Hyper identity");
    verifyRunIdentity(report.runIdentity, "Conformance fixture run identity");
    return;
  }
  exactKeys(
    report,
    [
      "environment",
      "familiesCovered",
      "fixtures",
      "note",
      "packages",
      "reportSha256",
      "schemaVersion",
      "summary",
    ],
    "Legacy conformance fixture report",
  );
  exactKeys(report.packages, ["hyper", "kit"], "Legacy conformance fixture packages");
  for (const id of ["kit", "hyper"]) {
    exactKeys(
      report.packages[id],
      ["commit", "tarballSha256"],
      `Legacy conformance fixture ${id} identity`,
    );
    if (!/^[0-9a-f]{40}$/u.test(report.packages[id].commit)
      || !/^[0-9a-f]{64}$/u.test(report.packages[id].tarballSha256)) {
      throw new Error(`Legacy conformance fixture ${id} identity is malformed.`);
    }
  }
}

export function verifyConformanceFixtureReport(report) {
  if (![LEGACY_SCHEMA_VERSION, SCHEMA_VERSION].includes(report.schemaVersion)) {
    throw new Error("Conformance fixture report has an unexpected schema version.");
  }
  verifyIdentitySection(report);

  if (report.note !== NOTE) throw new Error("Conformance fixture report note is invalid.");
  exactKeys(
    report.environment,
    ["architecture", "node", "operatingSystem"],
    "Conformance fixture environment",
  );
  if (Object.values(report.environment).some(
    (value) => typeof value !== "string" || value.length === 0,
  )) {
    throw new Error("Conformance fixture environment is incomplete.");
  }

  const unhashed = structuredClone(report);
  delete unhashed.reportSha256;
  if (report.reportSha256 !== sha256Hex(canonicalStringify(unhashed))) {
    throw new Error("Conformance fixture report hash does not match its content.");
  }

  if (!Array.isArray(report.fixtures) || report.fixtures.length !== REQUIRED_FIXTURES.length) {
    throw new Error("Conformance fixture report must contain exactly the required fixtures.");
  }
  if (new Set(report.fixtures.map((entry) => entry.id)).size !== report.fixtures.length) {
    throw new Error("Conformance fixture report repeats a fixture.");
  }
  for (const declared of REQUIRED_FIXTURES) {
    const entry = report.fixtures.find((candidate) => candidate.id === declared.id);
    if (entry === undefined) {
      throw new Error(`Conformance fixture report omits required fixture ${declared.id}.`);
    }
    exactKeys(entry, ["family", "id", "observed", "status"], `Conformance fixture ${declared.id}`);
    if (entry.family !== declared.family) {
      throw new Error(`Conformance fixture ${declared.id} changed family.`);
    }
  }
  if (report.fixtures.some((entry) => !["pass", "known_defect", "fail"].includes(entry.status))) {
    throw new Error("Conformance fixture report contains an unknown fixture status.");
  }

  const byStatus = (status) => report.fixtures.filter((entry) => entry.status === status);
  exactKeys(
    report.summary,
    ["failed", "failedIds", "knownDefectIds", "knownDefects", "passed", "ran", "required"],
    "Conformance fixture summary",
  );
  const expectedSummary = {
    failed: byStatus("fail").length,
    failedIds: byStatus("fail").map((entry) => entry.id).sort(),
    knownDefectIds: byStatus("known_defect").map((entry) => entry.id).sort(),
    knownDefects: byStatus("known_defect").length,
    passed: byStatus("pass").length,
    ran: report.fixtures.length,
    required: REQUIRED_FIXTURES.length,
  };
  if (canonicalStringify(report.summary) !== canonicalStringify(expectedSummary)) {
    throw new Error("Conformance fixture summary disagrees with the fixtures it summarises.");
  }

  const expectedFamilies = [...new Set(REQUIRED_FIXTURES.map((entry) => entry.family))].sort();
  if (canonicalStringify(report.familiesCovered) !== canonicalStringify(expectedFamilies)) {
    throw new Error("Conformance fixture family summary disagrees with the required fixtures.");
  }
  return true;
}
