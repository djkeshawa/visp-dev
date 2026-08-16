/**
 * The shape every packed suite run has: own a root, install both sides of the
 * pair from exact commits, drive the journey, seal a report, clean up.
 *
 * The four suites each had a ~90-line copy of this, and the copies had already
 * drifted: one forgot to attach the retained root to a thrown error, so a
 * `--keep` run that FAILED — the only case where keeping the scratch tree is
 * worth anything — deleted its own evidence. Cleanup lives in a `finally` here
 * once, and the retained root is attached on both paths.
 */
import process from "node:process";

import {
  cleanupOwnedRoot,
  createOwnedRoot,
  packAndInstall,
  toolVersion,
} from "../../toolchain/index.mjs";
import { plainObject } from "../../platform/shape.mjs";

/** Everything a packed run needs from its caller, and none of it optional. */
export const RUNNER_PATH_FIELDS = [
  "hyperRepositoryRoot",
  "kitRepositoryRoot",
  "offlineCacheSource",
  "offlineStoreSource",
  "packageManagerCommand",
  "npmCommand",
];

export function verifyRunnerInput(input, label) {
  plainObject(input, `${label} runner input`);
  for (const field of RUNNER_PATH_FIELDS) {
    if (typeof input[field] !== "string" || input[field].length === 0) {
      throw new TypeError(`${field} must be a non-empty path`);
    }
  }
  if (input.keepOwnedRoot !== undefined && typeof input.keepOwnedRoot !== "boolean") {
    throw new TypeError("keepOwnedRoot must be a boolean");
  }
  return true;
}

/** The tool versions and platform a report records so a reader can reproduce it. */
export async function packedEnvironment(input) {
  return {
    architecture: process.arch,
    git: await toolVersion("git"),
    node: process.version,
    npm: await toolVersion(input.npmCommand),
    operatingSystem: process.platform,
    pnpm: await toolVersion(input.packageManagerCommand),
  };
}

/**
 * A package id names its role: anything starting `kit` is packed from the Kit
 * repository. Suites use `kit`/`hyper`, `kitNew`/`hyperOld`, `kitFixed`/
 * `hyperCurrent` — all of them decided by this one prefix.
 */
function repositoryFor(id, input) {
  return id.startsWith("kit") ? input.kitRepositoryRoot : input.hyperRepositoryRoot;
}

/**
 * @param suite     the pinned suite, named in every failure
 * @param input     the runner input, validated here
 * @param packages  `{ id: {commit, tree} }` — every side this suite installs
 * @param journey   `({packages, ownedRoot}) => body` — the suite's own measurement
 * @param create    `(input) => report` — the suite's own sealed constructor
 */
export async function runPackedSuite({ suite, input, packages, journey, create }) {
  verifyRunnerInput(input, suite.id);
  const owned = await createOwnedRoot();
  const retain = input.keepOwnedRoot === true;
  const attach = (value) => {
    if (retain) Object.defineProperty(value, "retainedRoot", { enumerable: false, value: owned.root });
    return value;
  };
  try {
    const installed = {};
    for (const [id, definition] of Object.entries(packages)) {
      installed[id] = await packAndInstall({
        definition,
        kind: id.startsWith("kit") ? "kit" : "hyper",
        offlineCacheSource: input.offlineCacheSource,
        offlineStoreSource: input.offlineStoreSource,
        npmCommand: input.npmCommand,
        ownedRoot: owned.root,
        packageManagerCommand: input.packageManagerCommand,
        repositoryRoot: repositoryFor(id, input),
      });
    }
    const body = await journey({ ownedRoot: owned.root, packages: installed });
    return attach(create({
      ...body,
      environment: await packedEnvironment(input),
      packages: Object.fromEntries(
        Object.entries(installed).map(([id, value]) => [id, value.report]),
      ),
    }));
  } catch (error) {
    throw attach(error);
  } finally {
    if (!retain) await cleanupOwnedRoot({ root: owned.root });
  }
}
