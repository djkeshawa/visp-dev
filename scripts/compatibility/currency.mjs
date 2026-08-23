#!/usr/bin/env node
/**
 * Reports how far the newest frozen pair lags the checked-out engine repos.
 *
 * Two exit-code modes. By default an invalidating gap exits non-zero, so a
 * human or a gating job can act on it. With `--advisory` the verdict never
 * decides the exit code: the measurement is published as an annotation and in
 * the run summary instead, and the job it runs in is genuinely green.
 *
 * That is not the same as ignoring failures. `--advisory` neutralises the
 * VERDICT, not the process — a crash, a missing repository or a git error still
 * exits non-zero, which is exactly what appending `|| true` to the command
 * would have thrown away.
 */
import process from "node:process";

import { canonicalStringify } from "../../src/platform/canonical-json.mjs";
import {
  evidenceCurrencyAnnotations,
  evidenceCurrencyExitCode,
  measureEvidenceCurrency,
  renderEvidenceCurrency
} from "../../src/compatibility/registry/currency.mjs";
import { PUBLISHED_ARTIFACT_DIFFERENTIAL_DEFINITION }
  from "../../src/compatibility/suites/published-artifact-differential/index.mjs";

/**
 * Flags that are present or absent rather than carrying a value.
 *
 * Declared, because the loop below consumes the next argument as a value for
 * anything it does not recognise. `--advisory` would have eaten whatever
 * followed it, and `--json` — written with no value, as its own name invites —
 * silently did nothing at all, because it set `undefined` and the check for it
 * was `!== undefined`.
 */
const BOOLEAN_FLAGS = new Set(["--advisory", "--json"]);

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--")) continue;
    const key = flag.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    if (BOOLEAN_FLAGS.has(flag)) {
      options[key] = true;
      continue;
    }
    options[key] = argv[index + 1];
    index += 1;
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));
const report = await measureEvidenceCurrency({
  evidenceName: "published-artifact-differential",
  repositories: [
    {
      name: "visp-kit",
      root: options.kitRepository ?? "../visp-kit",
      pinnedCommit: PUBLISHED_ARTIFACT_DIFFERENTIAL_DEFINITION.packages.kitFixed.commit,
    },
    {
      name: "visp-hyper-agent",
      root: options.hyperRepository ?? "../visp-hyper-agent",
      pinnedCommit: PUBLISHED_ARTIFACT_DIFFERENTIAL_DEFINITION.packages.hyperCurrent.commit,
    },
  ],
});

if (options.json !== undefined || options.output !== undefined) {
  // No annotations here. They are workflow commands, not data, and appending
  // them to the document would make `--json --advisory` unparseable for the
  // machine consumer that asked for JSON in the first place.
  process.stdout.write(`${canonicalStringify(report)}\n`);
} else {
  process.stdout.write(renderEvidenceCurrency(report));

  // Advisory mode only: a run that can fail on the verdict already has a way to
  // be seen, and a warning beside a failure is noise. Written last so a
  // consumer piping stdout into a run summary drops them with one `^::` filter.
  if (options.advisory === true) {
    for (const annotation of evidenceCurrencyAnnotations(report)) {
      process.stdout.write(`${annotation}\n`);
    }
  }
}

process.exitCode = evidenceCurrencyExitCode(report, { advisory: options.advisory === true });
