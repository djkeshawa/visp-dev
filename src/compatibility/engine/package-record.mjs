/**
 * What a suite is allowed to say about one side of the pair.
 *
 * Four near-identical `validatePackage` functions lived in four suites. They
 * agreed on the hard part — duplicate pack, byte equality, offline install,
 * lifecycle scripts disabled, a real installed command — and differed only in
 * their labels and in whether they also pinned the tarball digest. Four copies
 * of a security-relevant check is four chances for one to fall behind, and the
 * one that fell behind would still report a clean suite.
 *
 * The identity helpers below came from `src/evidence-identity.mjs`, which the
 * evidence deletion removed. They are checks, not fixtures, so they survive it
 * (R4).
 */
import { canonicalStringify } from "../../platform/canonical-json.mjs";
import { COMMIT, HASH, exactKeys, exactValue } from "../../platform/shape.mjs";

/** The five fields that identify a PUBLISHED artifact. A version alone is not an identity. */
export const PACKAGE_IDENTITY_FIELDS = ["commit", "name", "tarballSha256", "tree", "version"];

export function verifyPackageIdentity(identity, label) {
  exactKeys(identity, PACKAGE_IDENTITY_FIELDS, label);
  if (typeof identity.name !== "string"
    || identity.name.length === 0
    || typeof identity.version !== "string"
    || identity.version.length === 0
    || !COMMIT.test(identity.commit)
    || !COMMIT.test(identity.tree)
    || !HASH.test(identity.tarballSha256)) {
    throw new Error(`${label} is malformed`);
  }
  return true;
}

/** Projects a `packAndInstall` result down to the published five-field identity. */
export function packageIdentityFromPacked(value, label) {
  const identity = {
    commit: value?.source?.commit,
    name: value?.pack?.first?.package?.name,
    tarballSha256: value?.pack?.first?.sha256,
    tree: value?.source?.tree,
    version: value?.pack?.first?.package?.version,
  };
  verifyPackageIdentity(identity, label);
  return identity;
}

export function packageIdentityEqual(left, right) {
  return canonicalStringify(left) === canonicalStringify(right);
}

/**
 * Which run produced this evidence.
 *
 * `runAttempt` is a decimal string rather than a number because that is what
 * the CI provider emits, and re-typing it here would let a report claim an
 * attempt the provider never recorded.
 */
export function verifyRunIdentity(runIdentity, label) {
  exactKeys(runIdentity, ["provider", "runAttempt", "runId"], label);
  if (!["github-actions", "local"].includes(runIdentity.provider)
    || typeof runIdentity.runId !== "string"
    || runIdentity.runId.length === 0
    || typeof runIdentity.runAttempt !== "string"
    || !/^[1-9][0-9]*$/u.test(runIdentity.runAttempt)) {
    throw new Error(`${label} is invalid`);
  }
  return true;
}

/**
 * One side of the pair, as a suite report records it.
 *
 * With `requirePublishedIdentity` the record IS the five-field published
 * identity and is compared field for field against the pin. Otherwise it is the
 * packed/installed provenance record, and `expected` is the `{commit, tree}`
 * source the suite pinned.
 *
 * @param options.expectedTarballSha256  pins the exact bytes this commit packs
 *                                       to. Only the suites that observed the
 *                                       pack once and froze it pass this.
 */
export function verifyPackedPackageRecord(record, expected, {
  label,
  packageName,
  binName,
  drift = "drifted from its frozen definition",
  expectedTarballSha256 = null,
  requireRuntimeLock = true,
  requireInstalledBin = true,
  requirePublishedIdentity = false,
} = {}) {
  if (requirePublishedIdentity) {
    verifyPackageIdentity(record, label);
    exactValue(record, expected, label, drift);
    return true;
  }

  exactKeys(record, ["install", "pack", "runtimeLock", "source"], label);
  exactValue(record.source, expected, `${label} source`, drift);

  const installedBin = (record.install?.bins ?? []).some(
    (entry) => entry.name === binName
      && entry.target === `node_modules/${packageName}/dist/index.js`
      && HASH.test(entry.sha256 ?? ""),
  );
  if (!COMMIT.test(record.source.commit)
    || !COMMIT.test(record.source.tree)
    || record.pack?.byteEquality !== true
    || record.pack?.first?.sha256 !== record.pack?.second?.sha256
    || !HASH.test(record.pack?.first?.sha256 ?? "")
    || record.install?.offline !== true
    || record.install?.lifecycleScriptsDisabled !== true
    || (requireInstalledBin && !installedBin)
    || (requireRuntimeLock && !HASH.test(record.runtimeLock?.materializedSha256 ?? ""))
    || (requireRuntimeLock && !HASH.test(record.runtimeLock?.templateSha256 ?? ""))) {
    throw new Error(`${label} lacks exact packed and tarball-installed provenance`);
  }

  if (expectedTarballSha256 !== null) {
    exactValue(
      record.pack.first.sha256,
      expectedTarballSha256,
      `${label} accepted pack hash`,
      drift,
    );
  }
  return true;
}
