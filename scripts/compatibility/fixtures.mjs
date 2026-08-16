#!/usr/bin/env node
/**
 * Runs the eleven conformance fixtures against packed binaries, or verifies a
 * report a previous run produced.
 *
 * A recorded defect is evidence and does not fail verification; an outright
 * failure means a fixture the product is supposed to satisfy did not hold, and
 * that must break the build.
 */
import process from "node:process";

import { entrypoint } from "./arguments.mjs";
import { runConformanceFixtures } from "../../src/compatibility/fixtures/execution.mjs";
import { verifyConformanceFixtureReport } from "../../src/compatibility/fixtures/report.mjs";

await entrypoint({
  label: "conformance-fixtures",
  errorCode: "CONFORMANCE_FIXTURES_ERROR",
  errorSchemaVersion: "visp.conformance-fixtures.error.v1",
  flags: {
    "--kit-repository": "kitRepositoryRoot",
    "--hyper-repository": "hyperRepositoryRoot",
    "--offline-store": "offlineStoreSource",
    "--offline-cache": "offlineCacheSource",
    "--package-manager": "packageManagerCommand",
    "--npm": "npmCommand",
    "--kit-commit": "kitCommit",
    "--kit-tree": "kitTree",
    "--hyper-commit": "hyperCommit",
    "--hyper-tree": "hyperTree",
    // Omit for a pre-rename pair; pass --kit-bin visp-kit --hyper-bin visp for
    // Kit >= 0.4.0 with Hyper >= 0.7.0.
    "--kit-bin": "kitBinName",
    "--hyper-bin": "hyperBinName",
    "--run-provider": "runProvider",
    "--run-id": "runId",
    "--run-attempt": "runAttempt",
  },
  required: [
    "kitRepositoryRoot",
    "hyperRepositoryRoot",
    "offlineStoreSource",
    "offlineCacheSource",
    "kitCommit",
    "kitTree",
    "hyperCommit",
    "hyperTree",
    "runProvider",
    "runId",
    "runAttempt",
  ],
  run: ({ runProvider, runId, runAttempt, ...input }) => runConformanceFixtures({
    ...input,
    packageManagerCommand: input.packageManagerCommand ?? "pnpm",
    npmCommand: input.npmCommand ?? "npm",
    runIdentity: { provider: runProvider, runId, runAttempt },
  }),
  verify: verifyConformanceFixtureReport,
  afterRun: (report, mode) => {
    if (mode === "verify") {
      const { passed, knownDefects, failed, ran, required } = report.summary;
      process.stderr.write(
        `PASS conformance fixtures verified: ${ran}/${required} ran, ` +
          `${passed} passed, ${knownDefects} known defects, ${failed} failed\n`,
      );
    } else {
      for (const entry of report.fixtures) {
        const mark = entry.status === "pass"
          ? "PASS"
          : entry.status === "known_defect" ? "DEFECT" : "FAIL";
        process.stderr.write(`${mark.padEnd(7)} ${entry.family.padEnd(13)} ${entry.id}\n`);
      }
    }
    if (report.summary.failed > 0) process.exitCode = 1;
  },
});
