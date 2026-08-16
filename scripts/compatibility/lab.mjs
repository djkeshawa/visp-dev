#!/usr/bin/env node
/**
 * The single-package laboratory: pin a commit, pack it twice, install it
 * offline, run the installed command, and emit one canonical observation.
 */
import process from "node:process";

import { canonicalStringify } from "../../src/platform/canonical-json.mjs";
import { runCompatibilityLab } from "../../src/toolchain/index.mjs";

function parseArguments(argv) {
  const input = { expectations: {} };
  const packageExpectation = {};
  const executionExpectation = { args: [], exitCode: 0 };
  let hasExecution = false;
  const takeValue = (index, flag) => {
    if (index + 1 >= argv.length) throw new TypeError(`${flag} requires a value`);
    return argv[index + 1];
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--repository") input.repositoryRoot = takeValue(index++, flag);
    else if (flag === "--commit") input.commit = takeValue(index++, flag);
    else if (flag === "--expect-package-name") packageExpectation.name = takeValue(index++, flag);
    else if (flag === "--expect-package-version") packageExpectation.version = takeValue(index++, flag);
    else if (flag === "--expect-bin") {
      packageExpectation.bins ??= [];
      packageExpectation.bins.push(takeValue(index++, flag));
    } else if (flag === "--run-bin") {
      executionExpectation.bin = takeValue(index++, flag);
      hasExecution = true;
    } else if (flag === "--bin-arg") {
      executionExpectation.args.push(takeValue(index++, flag));
      hasExecution = true;
    } else if (flag === "--expect-exit-code") {
      const value = takeValue(index++, flag);
      if (!/^-?\d+$/.test(value)) throw new TypeError("--expect-exit-code requires an integer");
      executionExpectation.exitCode = Number(value);
      hasExecution = true;
    } else if (flag === "--expect-stdout") {
      executionExpectation.stdout = takeValue(index++, flag);
      hasExecution = true;
    } else if (flag === "--expect-stderr") {
      executionExpectation.stderr = takeValue(index++, flag);
      hasExecution = true;
    } else if (flag === "--offline-cache") input.offlineCacheSource = takeValue(index++, flag);
    else if (flag === "--offline-install-lock") input.offlineInstallLockSource = takeValue(index++, flag);
    else if (flag === "--offline-store") input.offlineStoreSource = takeValue(index++, flag);
    else if (flag === "--package-manager") input.packageManagerCommand = takeValue(index++, flag);
    else if (flag === "--keep") input.keepOwnedRoot = true;
    else throw new TypeError(`Unknown argument: ${flag}`);
  }
  if (!input.repositoryRoot || !input.commit) {
    throw new TypeError("--repository and --commit are required");
  }
  if (Object.keys(packageExpectation).length > 0) input.expectations.package = packageExpectation;
  if (hasExecution) input.expectations.execution = executionExpectation;
  return input;
}

try {
  const result = await runCompatibilityLab(parseArguments(process.argv.slice(2)));
  process.stdout.write(canonicalStringify(result));
  if (result.retainedRoot) {
    process.stderr.write(`compatibility-lab: retained root ${result.retainedRoot}\n`);
  }
  process.exitCode = result.summary.assertions_passed ? 0 : 1;
} catch (error) {
  process.stderr.write(`compatibility-lab: ${error.message}\n`);
  if (error.retainedRoot) {
    process.stderr.write(`compatibility-lab: retained root ${error.retainedRoot}\n`);
  }
  process.stdout.write(canonicalStringify({
    error: { code: error.code ?? error.name ?? "LAB_ERROR" },
    schemaVersion: "visp.compatibility-lab.error.v1",
  }));
  process.exitCode = 1;
}
