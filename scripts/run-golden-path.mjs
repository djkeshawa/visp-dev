#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

import { canonicalStringify } from "../src/compatibility-lab.mjs";
import { runGoldenPath, verifyGoldenPathReport } from "../src/golden-path.mjs";

function parseArguments(argv) {
  const input = {};
  let outputPath = null;
  let verifyPath = null;
  const take = (index, flag) => {
    if (index + 1 >= argv.length) throw new TypeError(`${flag} requires a value`);
    return argv[index + 1];
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--kit-repository") input.kitRepositoryRoot = take(index++, flag);
    else if (flag === "--hyper-repository") input.hyperRepositoryRoot = take(index++, flag);
    else if (flag === "--kit-commit") input.kitCommit = take(index++, flag);
    else if (flag === "--kit-tree") input.kitTree = take(index++, flag);
    else if (flag === "--hyper-commit") input.hyperCommit = take(index++, flag);
    else if (flag === "--hyper-tree") input.hyperTree = take(index++, flag);
    else if (flag === "--offline-store") input.offlineStoreSource = take(index++, flag);
    else if (flag === "--offline-cache") input.offlineCacheSource = take(index++, flag);
    else if (flag === "--package-manager") input.packageManagerCommand = take(index++, flag);
    else if (flag === "--npm") input.npmCommand = take(index++, flag);
    else if (flag === "--output") outputPath = take(index++, flag);
    else if (flag === "--verify") verifyPath = take(index++, flag);
    else throw new TypeError(`Unknown argument: ${flag}`);
  }
  if (verifyPath !== null) return { mode: "verify", verifyPath };
  return { input, mode: "run", outputPath };
}

try {
  const parsed = parseArguments(process.argv.slice(2));
  let report;
  if (parsed.mode === "verify") {
    report = JSON.parse(await readFile(parsed.verifyPath, "utf8"));
    verifyGoldenPathReport(report);
  } else {
    report = await runGoldenPath(parsed.input);
    if (parsed.outputPath !== null) {
      await writeFile(parsed.outputPath, canonicalStringify(report), { flag: "wx", mode: 0o600 });
    }
  }
  process.stdout.write(`${canonicalStringify(report)}\n`);
} catch (error) {
  process.stderr.write(`golden-path: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
