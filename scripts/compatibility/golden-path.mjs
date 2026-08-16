#!/usr/bin/env node
/** Runs, or verifies a report of, the executable golden-path demonstration. */
import { entrypoint } from "./arguments.mjs";
import {
  runGoldenPath,
  verifyGoldenPathReport,
} from "../../src/compatibility/registry/golden-path.mjs";

await entrypoint({
  label: "golden-path",
  flags: {
    "--kit-repository": "kitRepositoryRoot",
    "--hyper-repository": "hyperRepositoryRoot",
    "--kit-commit": "kitCommit",
    "--kit-tree": "kitTree",
    "--hyper-commit": "hyperCommit",
    "--hyper-tree": "hyperTree",
    "--offline-store": "offlineStoreSource",
    "--offline-cache": "offlineCacheSource",
    "--package-manager": "packageManagerCommand",
    "--npm": "npmCommand",
    "--kit-bin": "kitBinName",
    "--hyper-bin": "hyperBinName",
    "--protocol": "protocol",
  },
  run: runGoldenPath,
  verify: verifyGoldenPathReport,
});
