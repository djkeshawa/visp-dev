#!/usr/bin/env node
/** Runs, or verifies a report of, the risk-profile evidence-validity suite. */
import {
  KEEP_FLAG,
  PAIR_FLAGS,
  PAIR_REQUIRED,
  entrypoint,
} from "./arguments.mjs";
import {
  runPackedRiskProfileEvidenceValidity,
  verifyRiskProfileEvidenceValidityReport,
} from "../../src/compatibility/suites/risk-profile-evidence-validity/index.mjs";

await entrypoint({
  label: "risk-profile-evidence-validity",
  errorCode: "RISK_PROFILE_EVIDENCE_VALIDITY_ERROR",
  errorSchemaVersion: "visp.risk-profile-evidence-validity.error.v1",
  flags: PAIR_FLAGS,
  booleans: KEEP_FLAG,
  required: PAIR_REQUIRED,
  run: runPackedRiskProfileEvidenceValidity,
  verify: verifyRiskProfileEvidenceValidityReport,
});
