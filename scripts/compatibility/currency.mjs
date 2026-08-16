#!/usr/bin/env node
/**
 * Reports how far the newest frozen pair lags the checked-out engine repos.
 *
 * Exits non-zero only when the gap is invalidating, so this can run in CI as a
 * standing check without failing the build every time a doc changes.
 */
import process from "node:process";

import { canonicalStringify } from "../../src/platform/canonical-json.mjs";
import { measureEvidenceCurrency } from "../../src/compatibility/registry/currency.mjs";
import { PUBLISHED_ARTIFACT_DIFFERENTIAL_DEFINITION }
  from "../../src/compatibility/suites/published-artifact-differential/index.mjs";

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    const key = argv[index].slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
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
  process.stdout.write(`${canonicalStringify(report)}\n`);
} else {
  process.stdout.write(`${report.summary.verdict}\n\n`);
  for (const repository of report.repositories) {
    process.stdout.write(
      `  ${repository.name.padEnd(18)} ${repository.commitsBehind} commits behind, ` +
        `${repository.changedFileCount} files, risk=${repository.risk}\n`,
    );
    for (const critical of repository.criticalPathsTouched) {
      process.stdout.write(
        `      ${critical.prefix} (${critical.files}) — ${critical.reason} [${critical.severity}]\n`,
      );
    }
  }
}

process.exitCode = report.summary.risk === "invalidating" ? 1 : 0;
