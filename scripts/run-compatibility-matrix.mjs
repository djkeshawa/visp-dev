#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

import { canonicalStringify } from "../src/compatibility-lab.mjs";
import {
  runPackedCompatibilityMatrix,
  verifyCompatibilityMatrixReport,
} from "../src/compatibility-matrix.mjs";

function parseArguments(argv) {
  const input = {};
  let outputPath = null;
  let verifyPath = null;
  const takeValue = (index, flag) => {
    if (index + 1 >= argv.length) throw new TypeError(`${flag} requires a value`);
    return argv[index + 1];
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--kit-repository") input.kitRepositoryRoot = takeValue(index++, flag);
    else if (flag === "--hyper-repository") input.hyperRepositoryRoot = takeValue(index++, flag);
    else if (flag === "--offline-store") input.offlineStoreSource = takeValue(index++, flag);
    else if (flag === "--offline-cache") input.offlineCacheSource = takeValue(index++, flag);
    else if (flag === "--row") input.row = takeValue(index++, flag);
    else if (flag === "--output") outputPath = takeValue(index++, flag);
    else if (flag === "--verify") verifyPath = takeValue(index++, flag);
    else if (flag === "--keep") input.keepOwnedRoot = true;
    else throw new TypeError(`Unknown argument: ${flag}`);
  }
  if (verifyPath !== null) {
    if (Object.keys(input).length !== 0 || outputPath !== null) {
      throw new TypeError("--verify cannot be combined with matrix-run arguments");
    }
    return { mode: "verify", verifyPath };
  }
  for (const field of [
    "kitRepositoryRoot",
    "hyperRepositoryRoot",
    "offlineStoreSource",
    "offlineCacheSource",
  ]) {
    if (!input[field]) throw new TypeError(`Missing required matrix argument: ${field}`);
  }
  return { input, mode: "run", outputPath };
}

try {
  const parsed = parseArguments(process.argv.slice(2));
  let report;
  if (parsed.mode === "verify") {
    report = JSON.parse(await readFile(parsed.verifyPath, "utf8"));
    verifyCompatibilityMatrixReport(report);
  } else {
    report = await runPackedCompatibilityMatrix(parsed.input);
    if (parsed.outputPath !== null) {
      await writeFile(parsed.outputPath, canonicalStringify(report), { flag: "wx", mode: 0o600 });
    }
  }
  process.stdout.write(canonicalStringify(report));
  if (report.retainedRoot) process.stderr.write(`compatibility-matrix: retained root ${report.retainedRoot}\n`);
} catch (error) {
  process.stderr.write(`compatibility-matrix: ${error.message}\n`);
  if (error.retainedRoot) process.stderr.write(`compatibility-matrix: retained root ${error.retainedRoot}\n`);
  process.stdout.write(canonicalStringify({
    error: { code: error.code ?? error.name ?? "MATRIX_ERROR" },
    schemaVersion: "visp.compatibility-matrix.error.v1",
  }));
  process.exitCode = 1;
}
