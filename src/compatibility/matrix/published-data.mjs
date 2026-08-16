/**
 * `compatibility.json` — the published pair table the shipped CLI reads.
 *
 * It used to be generated from the committed evidence directory. That directory
 * and its generator are gone, so the file is now HAND-MAINTAINED and this module
 * is what stops it drifting: every shape rule the generator used to guarantee is
 * asserted here instead, and `tests/unit/compatibility/matrix/published-data.test.mjs`
 * runs them against the real file.
 *
 * The rule that matters most: a pair is identified by commit, tree and tarball
 * hash, and NEVER by a version range. A version string is not an identity — the
 * same `visp-hyper-agent@0.3.0` exists on npm and in the repository 34 commits
 * apart.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const COMMIT = /^[0-9a-f]{40}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const PREFIXED_HASH = /^sha256:[0-9a-f]{64}$/u;
const SEMVER = /^\d+\.\d+\.\d+$/u;

export const PUBLISHED_MATRIX_PATH = fileURLToPath(
  new URL("../../../compatibility.json", import.meta.url),
);

export function readPublishedMatrix(path = PUBLISHED_MATRIX_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** One sentence per problem, naming the pair and the field. */
export function publishedMatrixViolations(matrix) {
  const problems = [];
  const require = (condition, message) => {
    if (!condition) problems.push(message);
  };

  require(matrix.model === "exact-pair", 'model must be "exact-pair"');
  require(Array.isArray(matrix.pairs) && matrix.pairs.length > 0, "pairs must be a non-empty array");

  for (const pair of matrix.pairs ?? []) {
    for (const side of ["kit", "hyper"]) {
      const entry = pair[side] ?? {};
      require(COMMIT.test(entry.commit ?? ""), `${pair.id} ${side} commit is not a full commit ID`);
      require(COMMIT.test(entry.tree ?? ""), `${pair.id} ${side} tree is not a full tree ID`);
      require(HASH.test(entry.tarballSha256 ?? ""), `${pair.id} ${side} tarball hash is malformed`);
      // A pair carries no version. Proof attaches to a commit and a tarball
      // hash; a version number would let a range creep back in.
      require(entry.version === null, `${pair.id} ${side} version must not assert a release`);
    }
    require(PREFIXED_HASH.test(pair.schemaHash ?? ""), `${pair.id} schema hash is malformed`);
    require(HASH.test(pair.evidenceSha256 ?? ""), `${pair.id} evidence hash is malformed`);
  }

  // Registry existence is a separate fact from support. When the evidenced pair
  // has been superseded, no release is recommended — proof of an older pair is
  // not a reason to install it.
  require(matrix.registryState !== undefined, "the matrix must record what the registries serve");
  if (matrix.registryState?.supersedesEvidencedPair === true) {
    require(matrix.supportedRelease === null, "a superseded pair must withhold the recommendation");
    require(matrix.releaseEvidence?.eligible === true, "a withheld recommendation keeps its evidence eligible");
    // The hazard must be concrete enough to act on, not a shrug.
    require(/visp-kit@[\d.]+/u.test(matrix.registryState.hazard ?? ""), "the hazard must name the Kit version");
    require(
      /visp-hyper-agent@[\d.]+/u.test(matrix.registryState.hazard ?? ""),
      "the hazard must name the Hyper version",
    );
    require(SEMVER.test(matrix.registryState.npm?.["visp-kit"] ?? ""), "registryState.npm visp-kit must be a version");
    require(
      SEMVER.test(matrix.registryState.npm?.["visp-hyper-agent"] ?? ""),
      "registryState.npm visp-hyper-agent must be a version",
    );
  } else if (matrix.supportedRelease !== null) {
    require(SEMVER.test(matrix.supportedRelease?.kit ?? ""), "supportedRelease.kit must be a version");
    require(SEMVER.test(matrix.supportedRelease?.hyper ?? ""), "supportedRelease.hyper must be a version");
  }
  return problems;
}
