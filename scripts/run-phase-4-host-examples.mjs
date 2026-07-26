#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

import { canonicalStringify } from "../src/compatibility-lab.mjs";
import {
  runPackedPhase4HostExamples,
  verifyPhase4HostExamplesReport,
} from "../src/phase-4-host-examples.mjs";

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
    if (flag === "--tarball") input.tarballPath = takeValue(index++, flag);
    else if (flag === "--repository") input.repositoryRoot = takeValue(index++, flag);
    else if (flag === "--offline-cache") input.offlineCacheSource = takeValue(index++, flag);
    else if (flag === "--npm") input.npmCommand = takeValue(index++, flag);
    else if (flag === "--output") outputPath = takeValue(index++, flag);
    else if (flag === "--verify") verifyPath = takeValue(index++, flag);
    else if (flag === "--keep") input.keepOwnedRoot = true;
    else throw new TypeError(`Unknown argument: ${flag}`);
  }
  if (verifyPath !== null) {
    if (Object.keys(input).length !== 0 || outputPath !== null) {
      throw new TypeError("--verify cannot be combined with runner arguments");
    }
    return { mode: "verify", verifyPath };
  }
  if (Boolean(input.tarballPath) === Boolean(input.repositoryRoot)) {
    throw new TypeError("Provide exactly one of --tarball or --repository");
  }
  if (input.tarballPath && !input.offlineCacheSource) {
    throw new TypeError("--tarball requires --offline-cache for a clean offline dependency install");
  }
  return { input, mode: "run", outputPath };
}

try {
  const parsed = parseArguments(process.argv.slice(2));
  let report;
  if (parsed.mode === "verify") {
    report = JSON.parse(await readFile(parsed.verifyPath, "utf8"));
    verifyPhase4HostExamplesReport(report, { requireRuntime: true });
  } else {
    report = await runPackedPhase4HostExamples(parsed.input);
    if (parsed.outputPath !== null) {
      await writeFile(parsed.outputPath, canonicalStringify(report), { flag: "wx", mode: 0o600 });
    }
  }
  process.stdout.write(canonicalStringify(report));
  if (report.retainedRoot) {
    process.stderr.write(`phase-4-host-examples: retained root ${report.retainedRoot}\n`);
  }
} catch (error) {
  process.stderr.write(`phase-4-host-examples: ${error.message}\n`);
  if (error.retainedRoot) {
    process.stderr.write(`phase-4-host-examples: retained root ${error.retainedRoot}\n`);
  }
  process.stdout.write(canonicalStringify({
    error: { code: error.code ?? error.name ?? "PHASE_4_HOST_EXAMPLES_ERROR" },
    schemaVersion: "visp.phase-4-host-examples.error.v1",
  }));
  process.exitCode = 1;
}
