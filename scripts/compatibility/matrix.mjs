#!/usr/bin/env node
/** Runs, or verifies a report of, the frozen exact-pair compatibility matrix. */
import { KEEP_FLAG, entrypoint } from "./arguments.mjs";
import { runPackedCompatibilityMatrix } from "../../src/compatibility/matrix/execution.mjs";
import { verifyCompatibilityMatrixReport } from "../../src/compatibility/matrix/report.mjs";

await entrypoint({
  label: "compatibility-matrix",
  errorCode: "MATRIX_ERROR",
  errorSchemaVersion: "visp.compatibility-matrix.error.v1",
  flags: {
    "--kit-repository": "kitRepositoryRoot",
    "--hyper-repository": "hyperRepositoryRoot",
    "--offline-store": "offlineStoreSource",
    "--offline-cache": "offlineCacheSource",
    "--row": "row",
  },
  booleans: KEEP_FLAG,
  required: [
    "kitRepositoryRoot",
    "hyperRepositoryRoot",
    "offlineStoreSource",
    "offlineCacheSource",
  ],
  run: runPackedCompatibilityMatrix,
  verify: verifyCompatibilityMatrixReport,
});
