#!/usr/bin/env node
/**
 * Runs, or verifies a report of, the published-artifact differential suite.
 *
 * `--verify` takes an explicit path. It used to default to a committed report,
 * so a bare `--verify` printed PASS about a file the caller never named — and
 * kept printing it after the pair it described had been superseded.
 */
import { PAIR_FLAGS, PAIR_REQUIRED, entrypoint } from "./arguments.mjs";
import {
  runPackedPublishedArtifactDifferential,
  verifyPublishedArtifactDifferentialReport,
} from "../../src/compatibility/suites/published-artifact-differential/index.mjs";

await entrypoint({
  label: "published-artifact-differential",
  errorCode: "PUBLISHED_ARTIFACT_DIFFERENTIAL_ERROR",
  errorSchemaVersion: "visp.published-artifact-differential.error.v1",
  flags: {
    ...PAIR_FLAGS,
    "--run-provider": "runProvider",
    "--run-id": "runId",
    "--run-attempt": "runAttempt",
  },
  required: [...PAIR_REQUIRED, "runProvider", "runId", "runAttempt"],
  run: ({ runProvider, runId, runAttempt, ...input }) =>
    runPackedPublishedArtifactDifferential({
      ...input,
      runIdentity: { provider: runProvider, runId, runAttempt },
    }),
  verify: verifyPublishedArtifactDifferentialReport,
  afterRun: (report) => {
    for (const row of report.compatibility) {
      process.stderr.write(`PASS ${row.id} (${row.surfaces.length} surfaces)\n`);
    }
    process.stderr.write(`differential identical: ${report.differential.identical}\n`);
  },
});
