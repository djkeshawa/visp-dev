#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

import { canonicalStringify } from "../src/compatibility-lab.mjs";
import {
  runPackedPhase6Compatibility,
  verifyPhase6CompatibilityReport
} from "../src/phase-6-compatibility.mjs";

function parseArguments(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (!argument.startsWith("--")) continue;

    const key = argument.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());

    options[key] = argv[index + 1];
    index += 1;
  }

  return options;
}

async function main() {
  const argv = process.argv.slice(2);
  const options = parseArguments(argv);

  if (argv.includes("--verify")) {
    const target = options.verify ?? "evidence/phase-6-pair-linux-x64-node24.json";
    const report = JSON.parse(await readFile(target, "utf8"));

    verifyPhase6CompatibilityReport(report);
    process.stdout.write(
      `PASS phase 6 pair verified: ${report.compatibility.length} rows at protocol 3.2, ` +
        `differential identical=${report.differential.identical}\n`
    );
    return;
  }

  const report = await runPackedPhase6Compatibility({
    kitRepositoryRoot: options.kitRepository,
    hyperRepositoryRoot: options.hyperRepository,
    offlineStoreSource: options.offlineStore,
    offlineCacheSource: options.offlineCache,
    packageManagerCommand: options.packageManager ?? "pnpm",
    npmCommand: options.npm ?? "npm"
  });
  const serialized = `${canonicalStringify(report)}\n`;

  if (options.output !== undefined) {
    await writeFile(options.output, serialized);
    process.stdout.write(`Wrote ${options.output}\n`);
  } else {
    process.stdout.write(serialized);
  }

  for (const row of report.compatibility) {
    process.stderr.write(`PASS ${row.id} (${row.surfaces.length} surfaces)\n`);
  }

  process.stderr.write(`differential identical: ${report.differential.identical}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
