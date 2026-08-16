#!/usr/bin/env node
/** Renders and runtime-verifies the five packed host integration examples. */
import { entrypoint } from "./arguments.mjs";
import { runPackedHostAssets } from "../../src/compatibility/host-assets/runtime.mjs";
import { verifyHostAssetsReport } from "../../src/compatibility/host-assets/report.mjs";

await entrypoint({
  label: "host-assets",
  errorCode: "HOST_ASSETS_ERROR",
  errorSchemaVersion: "visp.host-asset-rendering.error.v1",
  flags: {
    "--tarball": "tarballPath",
    "--repository": "repositoryRoot",
    "--offline-cache": "offlineCacheSource",
    "--npm": "npmCommand",
  },
  booleans: { "--keep": "keepOwnedRoot" },
  run: (input) => {
    if (Boolean(input.tarballPath) === Boolean(input.repositoryRoot)) {
      throw new TypeError("Provide exactly one of --tarball or --repository");
    }
    if (input.tarballPath && !input.offlineCacheSource) {
      throw new TypeError("--tarball requires --offline-cache for a clean offline dependency install");
    }
    return runPackedHostAssets(input);
  },
  verify: (report) => verifyHostAssetsReport(report, { requireRuntime: true }),
});
