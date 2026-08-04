#!/usr/bin/env node
/**
 * Runs the conformance fixtures against packed binaries, or verifies a report
 * that a previous run produced.
 */
import { readFile, writeFile } from "node:fs/promises";

import {
  runConformanceFixtures,
  verifyConformanceFixtureReport
} from "../src/conformance-fixtures.mjs";
import { canonicalStringify } from "../src/compatibility-lab.mjs";

function parseArguments(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (!argument.startsWith("--")) continue;

    const key = argument
      .slice(2)
      .replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());

    if (key === "verify") {
      options.verify = argv[index + 1];
      index += 1;
      continue;
    }

    options[key] = argv[index + 1];
    index += 1;
  }

  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));

  if (options.verify !== undefined) {
    const report = JSON.parse(await readFile(options.verify, "utf8"));

    verifyConformanceFixtureReport(report);

    const { passed, knownDefects, failed, ran, required } = report.summary;

    process.stdout.write(
      `PASS conformance fixtures verified: ${ran}/${required} ran, ` +
        `${passed} passed, ${knownDefects} known defects, ${failed} failed\n`
    );

    // A recorded defect is evidence and does not fail verification; an
    // outright failure means a fixture the product is supposed to satisfy did
    // not hold, and that must break the build.
    process.exit(failed > 0 ? 1 : 0);
  }

  const report = await runConformanceFixtures({
    kitRepositoryRoot: options.kitRepository,
    hyperRepositoryRoot: options.hyperRepository,
    offlineStoreSource: options.offlineStore,
    offlineCacheSource: options.offlineCache,
    packageManagerCommand: options.packageManager ?? "pnpm",
    npmCommand: options.npm ?? "npm",
    kitCommit: options.kitCommit,
    kitTree: options.kitTree,
    hyperCommit: options.hyperCommit,
    hyperTree: options.hyperTree,
    // Which command each side installs. Omit for a pre-rename pair; pass
    // --kit-bin visp-kit --hyper-bin visp for Kit >= 0.4.0 with Hyper >= 0.7.0.
    kitBinName: options.kitBin,
    hyperBinName: options.hyperBin,
    runIdentity: {
      provider: options.runProvider,
      runId: options.runId,
      runAttempt: options.runAttempt
    }
  });
  const serialized = `${canonicalStringify(report)}\n`;

  if (options.output !== undefined) {
    await writeFile(options.output, serialized);
    process.stdout.write(`Wrote ${options.output}\n`);
  } else {
    process.stdout.write(serialized);
  }

  for (const entry of report.fixtures) {
    const mark = entry.status === "pass" ? "PASS" : entry.status === "known_defect" ? "DEFECT" : "FAIL";

    process.stderr.write(`${mark.padEnd(7)} ${entry.family.padEnd(13)} ${entry.id}\n`);
  }

  process.exit(report.summary.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
