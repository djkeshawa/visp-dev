/**
 * The end-to-end laboratory: pin a commit, pack it twice, install it offline,
 * run the installed command, and emit one canonical document.
 *
 * Input is closed — an unknown key is a typo that would otherwise be ignored,
 * and an ignored option is an experiment that did not run the thing it claimed.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { canonicalStringify } from "../platform/canonical-json.mjs";
import { assertPlainRecord, rejectUnknownKeys, runChecked, trimLine } from "./process.mjs";
import { cleanupOwnedRoot, createOwnedRoot } from "./owned-root.mjs";
import { packPackageTwice } from "./npm-pack.mjs";
import { installLocalTarball, runInstalledBin } from "./npm-install.mjs";

function validateExpectations(expectations) {
  assertPlainRecord(expectations, "expectations");
  rejectUnknownKeys(expectations, new Set(["package", "execution"]), "expectations");
  if (expectations.package !== undefined) {
    assertPlainRecord(expectations.package, "expectations.package");
    rejectUnknownKeys(expectations.package, new Set(["name", "version", "bins"]), "expectations.package");
    for (const key of ["name", "version"]) {
      if (expectations.package[key] !== undefined && typeof expectations.package[key] !== "string") {
        throw new TypeError(`expectations.package.${key} must be a string`);
      }
    }
    if (expectations.package.bins !== undefined && (!Array.isArray(expectations.package.bins) || expectations.package.bins.some((item) => typeof item !== "string"))) {
      throw new TypeError("expectations.package.bins must be an array of strings");
    }
  }
  if (expectations.execution !== undefined) {
    assertPlainRecord(expectations.execution, "expectations.execution");
    rejectUnknownKeys(expectations.execution, new Set(["bin", "args", "exitCode", "stdout", "stderr"]), "expectations.execution");
    if (typeof expectations.execution.bin !== "string") throw new TypeError("expectations.execution.bin must be a string");
    if (!Array.isArray(expectations.execution.args) || expectations.execution.args.some((item) => typeof item !== "string")) {
      throw new TypeError("expectations.execution.args must be an array of strings");
    }
    if (!Number.isInteger(expectations.execution.exitCode)) throw new TypeError("expectations.execution.exitCode must be an integer");
    for (const key of ["stdout", "stderr"]) {
      if (expectations.execution[key] !== undefined && typeof expectations.execution[key] !== "string") {
        throw new TypeError(`expectations.execution.${key} must be a string`);
      }
    }
  }
  return structuredClone(expectations);
}

function addAssertion(assertions, id, expected, observed) {
  assertions.push({ expected, id, observed, passed: canonicalStringify(expected) === canonicalStringify(observed) });
}

async function environmentObservation(packToolVersion) {
  const [gitResult, pnpmResult] = await Promise.all([
    runChecked("git", ["--version"], {}, "Git version"),
    runChecked("pnpm", ["--version"], {}, "pnpm version"),
  ]);
  return {
    architecture: process.arch,
    git: trimLine(gitResult.stdout),
    node: process.version,
    operatingSystem: process.platform,
    packTool: { name: "npm", version: packToolVersion },
    pnpm: trimLine(pnpmResult.stdout),
  };
}

function publicPackObservation(pack) {
  return {
    byteSize: pack.byteSize,
    memberListBytes: pack.memberListBytes,
    memberListSha256: pack.memberListSha256,
    members: pack.members,
    package: pack.package,
    sha256: pack.sha256,
    tool: pack.tool,
  };
}

export async function runCompatibilityLab(input) {
  assertPlainRecord(input, "input");
  rejectUnknownKeys(
    input,
    new Set([
      "repositoryRoot",
      "commit",
      "expectations",
      "keepOwnedRoot",
      "offlineCacheSource",
      "offlineInstallLockSource",
      "offlineStoreSource",
      "packageManagerCommand",
    ]),
    "input",
  );
  const expectations = validateExpectations(input.expectations ?? {});
  if (input.keepOwnedRoot !== undefined && typeof input.keepOwnedRoot !== "boolean") {
    throw new TypeError("keepOwnedRoot must be a boolean");
  }
  if (typeof input.commit !== "string" || !/^[0-9a-f]{40}$/.test(input.commit)) {
    throw new TypeError("commit must be a full 40-character lowercase hexadecimal ID");
  }

  const owned = await createOwnedRoot();
  let result;
  try {
    const packed = await packPackageTwice({
      repositoryRoot: input.repositoryRoot,
      commit: input.commit,
      ownedRoot: owned.root,
      offlineStoreSource: input.offlineStoreSource,
      packageManagerCommand: input.packageManagerCommand,
    });
    const fixture = path.join(owned.root, "install");
    const installed = await installLocalTarball({
      tarballPath: packed.tarballPath,
      fixtureRoot: fixture,
      offlineCacheSource: input.offlineCacheSource,
      offlineInstallLockSource: input.offlineInstallLockSource,
    });
    const execution = expectations.execution
      ? await runInstalledBin({
        fixtureRoot: fixture,
        binName: expectations.execution.bin,
        args: expectations.execution.args,
      })
      : null;
    const assertions = [];
    if (expectations.package?.name !== undefined) addAssertion(assertions, "package_name", expectations.package.name, packed.package.name);
    if (expectations.package?.version !== undefined) addAssertion(assertions, "package_version", expectations.package.version, packed.package.version);
    if (expectations.package?.bins !== undefined) {
      addAssertion(assertions, "declared_bins", [...expectations.package.bins].sort(), packed.package.declaredBins.map(({ name }) => name));
    }
    if (expectations.execution) {
      addAssertion(assertions, "execution_exit_code", expectations.execution.exitCode, execution.exitCode);
      if (expectations.execution.stdout !== undefined) addAssertion(assertions, "execution_stdout", expectations.execution.stdout, execution.stdout.text);
      if (expectations.execution.stderr !== undefined) addAssertion(assertions, "execution_stderr", expectations.execution.stderr, execution.stderr.text);
    }
    const passed = assertions.filter(({ passed: assertionPassed }) => assertionPassed).length;
    result = {
      assertions,
      expectations,
      observations: {
        environment: await environmentObservation(packed.first.tool.version),
        execution,
        install: installed,
        package: packed.package,
        preparations: packed.preparations,
        packs: {
          byteEquality: true,
          first: publicPackObservation(packed.first),
          second: publicPackObservation(packed.second),
        },
        source: { commit: packed.commit, tree: packed.tree },
      },
      schemaVersion: "visp.compatibility-lab.observation.v1",
      summary: {
        assertions_passed: passed === assertions.length,
        failed: assertions.length - passed,
        passed,
      },
    };
    await writeFile(path.join(owned.root, "observation.json"), canonicalStringify(result), { flag: "wx" });
    if (input.keepOwnedRoot === true) {
      Object.defineProperty(result, "retainedRoot", { enumerable: false, value: owned.root });
    }
    return result;
  } catch (error) {
    if (input.keepOwnedRoot === true) {
      Object.defineProperty(error, "retainedRoot", { enumerable: false, value: owned.root });
    }
    throw error;
  } finally {
    await cleanupOwnedRoot({ root: owned.root, keep: input.keepOwnedRoot === true });
  }
}
