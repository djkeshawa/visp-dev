/**
 * One case is dropped: "legacy generated platform evidence still verifies at its
 * legacy schema", which read `evidence/conformance-fixtures-linux-x64-node24.json`.
 * The file went with the evidence deletion. The legacy READER survives (R4), and
 * the case below builds a legacy-shaped report in memory so the v1 branch is
 * still exercised without a committed sample.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { canonicalStringify, sha256Hex } from "../../../../src/platform/canonical-json.mjs";
import {
  createConformanceFixtureReport,
  verifyConformanceFixtureReport,
} from "../../../../src/compatibility/fixtures/report.mjs";
import { REQUIRED_FIXTURES } from "../../../../src/compatibility/fixtures/families.mjs";

const RUN_IDENTITY = { provider: "github-actions", runAttempt: "1", runId: "30686678616" };
const ENVIRONMENT = { architecture: "x64", node: "v24.0.0", operatingSystem: "linux" };

const PACKAGES = {
  kit: {
    source: { commit: "a".repeat(40), tree: "b".repeat(40) },
    pack: { first: { package: { name: "visp-kit", version: "1.0.0" }, sha256: "c".repeat(64) } },
  },
  hyper: {
    source: { commit: "d".repeat(40), tree: "e".repeat(40) },
    pack: {
      first: { package: { name: "visp-hyper-agent", version: "2.0.0" }, sha256: "f".repeat(64) },
    },
  },
};

const everyFixture = (status) =>
  REQUIRED_FIXTURES.map((entry) => ({ ...entry, status, observed: {} }));

const report = (fixtures = everyFixture("pass")) => createConformanceFixtureReport({
  environment: ENVIRONMENT,
  fixtures,
  packages: PACKAGES,
  runIdentity: RUN_IDENTITY,
});

function reseal(value) {
  const next = structuredClone(value);
  delete next.reportSha256;
  next.reportSha256 = sha256Hex(canonicalStringify(next));
  return next;
}

test("a report is self-hashed and stable under key reordering", () => {
  const value = report();
  assert.equal(verifyConformanceFixtureReport(value), true);

  const reordered = { ...value };
  delete reordered.fixtures;
  reordered.fixtures = value.fixtures;
  assert.equal(verifyConformanceFixtureReport(reordered), true);
});

test("a tampered report fails verification", () => {
  const tampered = structuredClone(report());
  tampered.fixtures[0].status = "fail";
  assert.throws(() => verifyConformanceFixtureReport(tampered), /hash does not match/u);
});

test("a report that omits a required fixture is rejected", () => {
  // Rehashing cannot launder a missing fixture: the check is against the
  // declared list, not the list the report happens to contain. Construction
  // verifies before returning, so an incomplete report cannot even be built.
  const complete = report();
  assert.throws(
    () => createConformanceFixtureReport({
      environment: ENVIRONMENT,
      fixtures: complete.fixtures.slice(1),
      packages: PACKAGES,
      runIdentity: RUN_IDENTITY,
    }),
    /exactly the required fixtures|omits required fixture/u,
  );
});

test("a summary that disagrees with its fixtures is rejected", () => {
  const fixtures = everyFixture("pass");
  fixtures[0].status = "known_defect";
  const value = report(fixtures);
  assert.equal(value.summary.knownDefects, 1);

  const laundered = structuredClone(value);
  // The exact dishonesty this verifier exists to catch: a clean-looking summary
  // over fixtures that recorded a defect.
  laundered.summary.knownDefects = 0;
  assert.throws(() => verifyConformanceFixtureReport(laundered), /hash does not match/u);

  // And rehashing does not save it either.
  assert.throws(
    () => verifyConformanceFixtureReport(reseal(laundered)),
    /summary disagrees with the fixtures/u,
  );
});

test("an unknown fixture status is refused at construction", () => {
  assert.throws(
    () => createConformanceFixtureReport({
      environment: ENVIRONMENT,
      fixtures: [{ ...REQUIRED_FIXTURES[0], status: "probably_fine", observed: {} }],
      packages: PACKAGES,
      runIdentity: RUN_IDENTITY,
    }),
    /exactly the required fixtures|omits required fixture|unknown status/u,
  );
});

test("a new report preserves full identity and accepts honest rehashed observations", () => {
  const value = report();
  assert.equal(verifyConformanceFixtureReport(value), true);
  assert.deepEqual(value.runIdentity, RUN_IDENTITY);
  assert.deepEqual(Object.keys(value.packages.kit).sort(), [
    "commit",
    "name",
    "tarballSha256",
    "tree",
    "version",
  ]);

  const changed = structuredClone(value);
  changed.packages.kit.tree = "0".repeat(40);
  assert.equal(verifyConformanceFixtureReport(reseal(changed)), true);
});

test("an invalid run identity is refused", () => {
  for (const runIdentity of [
    { provider: "somewhere", runAttempt: "1", runId: "1" },
    { provider: "local", runAttempt: "01", runId: "1" },
    { provider: "local", runAttempt: "1", runId: "" },
  ]) {
    assert.throws(() => createConformanceFixtureReport({
      environment: ENVIRONMENT,
      fixtures: everyFixture("pass"),
      packages: PACKAGES,
      runIdentity,
    }));
  }
});

test("the legacy two-field package identity still verifies at its legacy schema", () => {
  // R4: the verification logic outlives its samples. The committed v1 report is
  // gone, so the legacy branch is exercised against a report built here.
  const legacy = {
    schemaVersion: "visp.conformance-fixtures.v1",
    note: "Fixtures run against packed, installed binaries. A fixture that observes a defect reports known_defect, never pass.",
    environment: ENVIRONMENT,
    packages: {
      hyper: { commit: "d".repeat(40), tarballSha256: "f".repeat(64) },
      kit: { commit: "a".repeat(40), tarballSha256: "c".repeat(64) },
    },
    fixtures: everyFixture("pass").sort((left, right) => left.id.localeCompare(right.id)),
    summary: {
      failed: 0,
      failedIds: [],
      knownDefectIds: [],
      knownDefects: 0,
      passed: REQUIRED_FIXTURES.length,
      ran: REQUIRED_FIXTURES.length,
      required: REQUIRED_FIXTURES.length,
    },
    familiesCovered: ["failure_mode", "hook", "security"],
  };
  const sealed = reseal(legacy);
  assert.equal(verifyConformanceFixtureReport(sealed), true);
  assert.deepEqual(sealed.familiesCovered, ["failure_mode", "hook", "security"]);

  // A legacy report may not smuggle in a run identity it never had.
  const smuggled = reseal({ ...legacy, runIdentity: RUN_IDENTITY });
  assert.throws(() => verifyConformanceFixtureReport(smuggled), /unexpected field set/u);
});
