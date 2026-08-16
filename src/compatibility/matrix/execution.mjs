/**
 * Running the whole matrix: pack each distinct commit once, install it offline,
 * then drive every selected row and the negative corpus against those installs.
 *
 * Packing is keyed by COMMIT, not by row, because three rows share one Hyper.
 * Packing it three times would produce three tarballs that ought to be
 * byte-identical and would silently pass if they were not.
 *
 * `--row` returns a DEBUG document with its own schema version and no summary.
 * A partial run must not be shaped like a complete one.
 */
import path from "node:path";
import process from "node:process";

import { canonicalStringify } from "../../platform/canonical-json.mjs";
import { plainObject } from "../../platform/shape.mjs";
import {
  cleanupOwnedRoot,
  createOwnedRoot,
  installLocalTarball,
  materializeRuntimeInstallLock,
  packPackageTwice,
  toolVersion,
} from "../../toolchain/index.mjs";
import {
  COMPATIBILITY_MATRIX_ROWS,
  selectCompatibilityMatrixRows,
} from "./rows.mjs";
import { deliberatelyUnsupportedEvidence, positiveRowEvidence } from "./evidence.mjs";
import { createCompatibilityMatrixReport } from "./report.mjs";

const REQUIRED_FIELDS = [
  "hyperRepositoryRoot",
  "kitRepositoryRoot",
  "offlineCacheSource",
  "offlineStoreSource",
];

function publicPack(pack) {
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

async function packAndInstallCommit({ commit, definition, input, ownedRoot }) {
  const packageRoot = await createOwnedRoot({ baseDirectory: ownedRoot });
  const packed = await packPackageTwice({
    repositoryRoot: definition.repositoryRoot,
    commit,
    ownedRoot: packageRoot.root,
    offlineStoreSource: input.offlineStoreSource,
  });
  const materializedLock = path.join(packageRoot.root, "runtime-package-lock.json");
  const runtimeLock = await materializeRuntimeInstallLock({
    outputPath: materializedLock,
    package: packed.package,
    tarballPath: packed.tarballPath,
  });
  const fixture = path.join(packageRoot.root, "install");
  const install = await installLocalTarball({
    tarballPath: packed.tarballPath,
    fixtureRoot: fixture,
    offlineCacheSource: input.offlineCacheSource,
    offlineInstallLockSource: materializedLock,
  });
  return {
    evidence: {
      install,
      pack: {
        byteEquality: true,
        first: publicPack(packed.first),
        second: publicPack(packed.second),
      },
      preparations: [packed.preparations.first, packed.preparations.second],
      runtimeLock,
      source: { commit: packed.commit, tree: packed.tree },
    },
    fixture,
  };
}

export async function runPackedCompatibilityMatrix(input) {
  plainObject(input, "matrix runner input");
  for (const field of REQUIRED_FIELDS) {
    if (typeof input[field] !== "string" || input[field].length === 0) {
      throw new TypeError(`${field} must be a non-empty path`);
    }
  }
  if (input.keepOwnedRoot !== undefined && typeof input.keepOwnedRoot !== "boolean") {
    throw new TypeError("keepOwnedRoot must be a boolean");
  }
  const selectedDefinitions = selectCompatibilityMatrixRows(input.row ?? null);
  const owned = await createOwnedRoot();
  const attach = (value) => {
    if (input.keepOwnedRoot === true) {
      Object.defineProperty(value, "retainedRoot", { enumerable: false, value: owned.root });
    }
    return value;
  };
  try {
    const packageDefinitions = new Map();
    for (const row of selectedDefinitions) {
      packageDefinitions.set(row.kit.commit, { repositoryRoot: input.kitRepositoryRoot, source: row.kit });
      packageDefinitions.set(row.hyper.commit, { repositoryRoot: input.hyperRepositoryRoot, source: row.hyper });
    }
    const artifacts = new Map();
    const packages = {};
    for (const [commit, definition] of packageDefinitions) {
      const built = await packAndInstallCommit({ commit, definition, input, ownedRoot: owned.root });
      artifacts.set(commit, built);
      packages[commit] = built.evidence;
    }

    const rowEvidence = [];
    for (const definition of selectedDefinitions) {
      const rowRoot = await createOwnedRoot({ baseDirectory: owned.root });
      rowEvidence.push({
        id: definition.id,
        scenarios: await positiveRowEvidence(
          definition,
          rowRoot.root,
          artifacts.get(definition.kit.commit),
          artifacts.get(definition.hyper.commit),
        ),
      });
    }

    if (input.row !== undefined) {
      return attach(JSON.parse(canonicalStringify({
        packages,
        rows: selectedDefinitions.map((definition) => ({
          canonicalSurfaces: definition.canonicalSurfaces,
          expectedProtocol: definition.expectedProtocol,
          hyper: definition.hyper,
          id: definition.id,
          kit: definition.kit,
          scenarios: rowEvidence.find(({ id }) => id === definition.id).scenarios,
          selection: definition.selection,
        })),
        schemaVersion: "visp.compatibility-matrix.debug.v1",
        selection: { rows: selectedDefinitions.map(({ id }) => id) },
      })));
    }

    const negativeRoot = await createOwnedRoot({ baseDirectory: owned.root });
    const final = COMPATIBILITY_MATRIX_ROWS.at(-1);
    const deliberatelyUnsupported = await deliberatelyUnsupportedEvidence(
      negativeRoot.root,
      artifacts.get(final.kit.commit),
      artifacts.get(final.hyper.commit),
    );
    return attach(createCompatibilityMatrixReport({
      deliberatelyUnsupported,
      environment: {
        architecture: process.arch,
        git: await toolVersion("git"),
        node: process.version,
        npm: await toolVersion("npm"),
        operatingSystem: process.platform,
        pnpm: await toolVersion("pnpm"),
      },
      packages,
      rows: rowEvidence,
    }));
  } catch (error) {
    throw attach(error);
  } finally {
    await cleanupOwnedRoot({ root: owned.root, keep: input.keepOwnedRoot === true });
  }
}
