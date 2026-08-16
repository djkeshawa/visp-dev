#!/usr/bin/env node
/** Runs, or verifies a report of, the mixed-generation negotiation suite. */
import {
  KEEP_FLAG,
  PAIR_FLAGS,
  PAIR_REQUIRED,
  entrypoint,
} from "./arguments.mjs";
import {
  runPackedMixedGenerationNegotiation,
  verifyMixedGenerationNegotiationReport,
} from "../../src/compatibility/suites/mixed-generation-negotiation/index.mjs";

await entrypoint({
  label: "mixed-generation-negotiation",
  errorCode: "MIXED_GENERATION_NEGOTIATION_ERROR",
  errorSchemaVersion: "visp.mixed-generation-negotiation.error.v1",
  flags: PAIR_FLAGS,
  booleans: KEEP_FLAG,
  required: PAIR_REQUIRED,
  run: runPackedMixedGenerationNegotiation,
  verify: verifyMixedGenerationNegotiationReport,
});
