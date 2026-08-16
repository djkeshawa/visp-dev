#!/usr/bin/env node
/** Runs, or verifies a report of, the additive enforcement-fixes suite. */
import {
  KEEP_FLAG,
  PAIR_FLAGS,
  PAIR_REQUIRED,
  entrypoint,
} from "./arguments.mjs";
import {
  runPackedAdditiveEnforcementFixes,
  verifyAdditiveEnforcementFixesReport,
} from "../../src/compatibility/suites/additive-enforcement-fixes/index.mjs";

await entrypoint({
  label: "additive-enforcement-fixes",
  errorCode: "ADDITIVE_ENFORCEMENT_FIXES_ERROR",
  errorSchemaVersion: "visp.additive-enforcement-fixes.error.v1",
  flags: PAIR_FLAGS,
  booleans: KEEP_FLAG,
  required: PAIR_REQUIRED,
  run: runPackedAdditiveEnforcementFixes,
  verify: verifyAdditiveEnforcementFixesReport,
});
