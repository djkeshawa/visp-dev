import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  REQUIRED_FIXTURES,
  createConformanceFixtureReport,
  verifyConformanceFixtureReport
} from "../src/conformance-fixtures.mjs";

const PACKAGES = {
  kit: { source: { commit: "a".repeat(40) }, pack: { first: { sha256: "b".repeat(64) } } },
  hyper: { source: { commit: "c".repeat(40) }, pack: { first: { sha256: "d".repeat(64) } } }
};
const ENVIRONMENT = { architecture: "x64", node: "v24.0.0", operatingSystem: "linux" };

const everyFixture = (status) =>
  REQUIRED_FIXTURES.map((entry) => ({ ...entry, status, observed: {} }));

test("a report is self-hashed and stable under key reordering", () => {
  const report = createConformanceFixtureReport({
    fixtures: everyFixture("pass"),
    packages: PACKAGES,
    environment: ENVIRONMENT
  });

  assert.equal(verifyConformanceFixtureReport(report), true);

  const reordered = { ...report };

  delete reordered.fixtures;
  reordered.fixtures = report.fixtures;

  assert.equal(verifyConformanceFixtureReport(reordered), true);
});

test("a tampered report fails verification", () => {
  const report = createConformanceFixtureReport({
    fixtures: everyFixture("pass"),
    packages: PACKAGES,
    environment: ENVIRONMENT
  });
  const tampered = structuredClone(report);

  tampered.fixtures[0].status = "fail";

  assert.throws(() => verifyConformanceFixtureReport(tampered), /hash does not match/u);
});

test("a report that omits a required fixture is rejected", () => {
  const report = createConformanceFixtureReport({
    fixtures: everyFixture("pass"),
    packages: PACKAGES,
    environment: ENVIRONMENT
  });
  // Rehashing cannot launder a missing fixture: the check is against the
  // declared list, not the list the report happens to contain. Construction
  // verifies before returning, so an incomplete report cannot even be built.
  assert.throws(
    () =>
      createConformanceFixtureReport({
        fixtures: report.fixtures.slice(1),
        packages: PACKAGES,
        environment: ENVIRONMENT
      }),
    /omits required fixture/u
  );
});

test("a summary that disagrees with its fixtures is rejected", () => {
  const fixtures = everyFixture("pass");

  fixtures[0].status = "known_defect";

  const report = createConformanceFixtureReport({
    fixtures,
    packages: PACKAGES,
    environment: ENVIRONMENT
  });

  assert.equal(report.summary.knownDefects, 1);

  const laundered = structuredClone(report);

  // The exact dishonesty this verifier exists to catch: a clean-looking
  // summary over fixtures that recorded a defect.
  laundered.summary.knownDefects = 0;

  assert.throws(() => verifyConformanceFixtureReport(laundered), /hash does not match/u);
});

test("an unknown fixture status is refused at construction", () => {
  assert.throws(
    () =>
      createConformanceFixtureReport({
        fixtures: [{ ...REQUIRED_FIXTURES[0], status: "probably_fine", observed: {} }],
        packages: PACKAGES,
        environment: ENVIRONMENT
      }),
    /omits required fixture|unknown status/u
  );
});

test("the committed fixture evidence verifies and records real observations", async () => {
  const report = JSON.parse(
    await readFile(new URL("../evidence/conformance-fixtures-linux-x64-node24.json", import.meta.url), "utf8")
  );

  assert.equal(verifyConformanceFixtureReport(report), true);
  assert.equal(report.summary.failed, 0, "committed evidence must not contain outright failures");
  assert.equal(report.summary.ran, REQUIRED_FIXTURES.length);
  assert.deepEqual(report.familiesCovered, ["failure_mode", "hook", "security"]);

  // F-C1 and F-C2 were recorded here as known defects and fixed in Kit at
  // 2fd30d3. This assertion is what noticed the evidence had gone stale, and
  // it keeps working in the other direction: a regression reintroduces a
  // known_defect and fails here rather than passing quietly.
  assert.deepEqual(report.summary.knownDefectIds, []);
  assert.equal(report.summary.passed, report.summary.ran);
});
