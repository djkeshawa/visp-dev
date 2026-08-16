/**
 * Packing both sides, installing them, and running every fixture family against
 * the result.
 *
 * The commits are caller-supplied rather than pinned. This is the one part of
 * the compatibility domain that is deliberately unpinned: it asks "does THIS
 * pair behave", so a platform job can point it at whatever pair the release
 * train is currently proving.
 */
import path from "node:path";
import process from "node:process";

import {
  cleanupOwnedRoot,
  createOwnedRoot,
  defaultBinName,
  executionEnvironment,
  packAndInstall,
  pathCommand,
} from "../../toolchain/index.mjs";
import { verifyRunIdentity } from "../engine/package-record.mjs";
import { failureModeFixtures, hookFixtures, securityFixtures } from "./families.mjs";
import { createConformanceFixtureReport } from "./report.mjs";

const REQUIRED_FIELDS = [
  "kitRepositoryRoot",
  "hyperRepositoryRoot",
  "offlineStoreSource",
  "offlineCacheSource",
  "packageManagerCommand",
  "npmCommand",
  "kitCommit",
  "kitTree",
  "hyperCommit",
  "hyperTree",
];

export async function runConformanceFixtures(input) {
  for (const field of REQUIRED_FIELDS) {
    if (typeof input[field] !== "string" || input[field].length === 0) {
      throw new TypeError(`${field} must be a non-empty string`);
    }
  }
  // Optional, but if supplied they must be real command names: a blank or
  // non-string bin name would silently fall back to the pre-rename default and
  // test the wrong binary, which is the failure this parameter exists to stop.
  for (const field of ["kitBinName", "hyperBinName"]) {
    if (input[field] !== undefined
      && (typeof input[field] !== "string" || input[field].length === 0)) {
      throw new TypeError(`${field} must be a non-empty string when provided`);
    }
  }
  verifyRunIdentity(input.runIdentity, "Conformance fixture run identity");

  const owned = await createOwnedRoot();
  try {
    const common = {
      offlineCacheSource: input.offlineCacheSource,
      offlineStoreSource: input.offlineStoreSource,
      npmCommand: input.npmCommand,
      ownedRoot: owned.root,
      packageManagerCommand: input.packageManagerCommand,
    };
    // Kit released `visp` to Hyper in 0.4.0, so which command each side installs
    // is a property of the pair under test. Callers pin it; the defaults keep
    // the pre-rename pairs this suite has historically covered working.
    const kitBin = input.kitBinName ?? defaultBinName("kit");
    const hyperBin = input.hyperBinName ?? defaultBinName("hyper");
    const kit = await packAndInstall({
      ...common,
      definition: { commit: input.kitCommit, tree: input.kitTree },
      kind: "kit",
      binName: kitBin,
      repositoryRoot: input.kitRepositoryRoot,
    });
    const hyper = await packAndInstall({
      ...common,
      definition: { commit: input.hyperCommit, tree: input.hyperTree },
      kind: "hyper",
      binName: hyperBin,
      repositoryRoot: input.hyperRepositoryRoot,
    });

    const env = executionEnvironment(kit, hyper, await pathCommand("git"));
    const workspace = await createOwnedRoot({ baseDirectory: owned.root });
    const shared = {
      kitExecutable: kit.executable,
      // The command name the engine actually installs, so content assertions can
      // name it rather than matching any string starting "visp".
      kitBinName: kitBin,
      env,
      root: workspace.root,
    };
    const fixtures = [
      ...(await hookFixtures(shared)),
      ...(await securityFixtures({
        ...shared,
        kitInstallRoot: path.join(kit.fixture, "node_modules", "visp-kit"),
      })),
      ...(await failureModeFixtures({ ...shared, hyperExecutable: hyper.executable })),
    ];

    return createConformanceFixtureReport({
      fixtures,
      packages: { kit: kit.report, hyper: hyper.report },
      runIdentity: input.runIdentity,
      environment: {
        architecture: process.arch,
        node: process.version,
        operatingSystem: process.platform,
      },
    });
  } finally {
    await cleanupOwnedRoot({ root: owned.root });
  }
}
