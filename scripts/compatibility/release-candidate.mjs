#!/usr/bin/env node
/**
 * Assembles a release candidate from exact local commits, or records evidence
 * about an already-published pair with `--released`.
 *
 * It publishes nothing: the module it calls has no registry write path.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";

import { canonicalStringify } from "../../src/platform/canonical-json.mjs";
import { assembleReleaseCandidate } from "../../src/compatibility/registry/release-candidate.mjs";

function parseArguments(argv) {
  const input = { targets: [] };
  let outputPath = null;
  const take = (index, flag) => {
    if (index + 1 >= argv.length) throw new TypeError(`${flag} requires a value`);
    return argv[index + 1];
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--repository") {
      const [name, repositoryPath] = take(index++, flag).split("=");
      if (!name || !repositoryPath) throw new TypeError("--repository expects <name>=<path>");
      input.targets.push({ name, repositoryPath });
    } else if (flag === "--offline-store") input.offlineStoreSource = take(index++, flag);
    else if (flag === "--package-manager") input.packageManagerCommand = take(index++, flag);
    else if (flag === "--npm") input.npmCommand = take(index++, flag);
    else if (flag === "--released") input.released = true;
    else if (flag === "--output") outputPath = take(index++, flag);
    else throw new TypeError(`Unknown argument: ${flag}`);
  }
  if (input.targets.length === 0) throw new TypeError("At least one --repository is required");
  for (const field of ["offlineStoreSource", "packageManagerCommand", "npmCommand"]) {
    if (!input[field]) throw new TypeError(`Missing required argument: ${field}`);
  }
  return { input, outputPath };
}

try {
  const { input, outputPath } = parseArguments(process.argv.slice(2));
  const report = await assembleReleaseCandidate(input);
  if (outputPath !== null) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, canonicalStringify(report), { flag: "wx", mode: 0o600 });
  }
  process.stdout.write(`${canonicalStringify(report)}\n`);
} catch (error) {
  process.stderr.write(
    `release-candidate: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
