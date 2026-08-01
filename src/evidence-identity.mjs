import { canonicalStringify } from "./compatibility-lab.mjs";

const COMMIT = /^[0-9a-f]{40}$/u;
const HASH = /^[0-9a-f]{64}$/u;

export function plainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }

  return value;
}

export function exactKeys(value, keys, label) {
  plainObject(value, label);

  if (canonicalStringify(Object.keys(value).sort()) !== canonicalStringify([...keys].sort())) {
    throw new Error(`${label} has an unexpected field set`);
  }
}

export function verifyPackageIdentity(identity, label) {
  exactKeys(identity, ["commit", "name", "tarballSha256", "tree", "version"], label);

  if (
    typeof identity.name !== "string" ||
    identity.name.length === 0 ||
    typeof identity.version !== "string" ||
    identity.version.length === 0 ||
    !COMMIT.test(identity.commit) ||
    !COMMIT.test(identity.tree) ||
    !HASH.test(identity.tarballSha256)
  ) {
    throw new Error(`${label} is malformed`);
  }

  return true;
}

export function packageIdentityFromPacked(value, label) {
  const identity = {
    commit: value?.source?.commit,
    name: value?.pack?.first?.package?.name,
    tarballSha256: value?.pack?.first?.sha256,
    tree: value?.source?.tree,
    version: value?.pack?.first?.package?.version
  };

  verifyPackageIdentity(identity, label);

  return identity;
}

export function packageIdentityEqual(left, right) {
  return canonicalStringify(left) === canonicalStringify(right);
}

export function verifyRunIdentity(runIdentity, label) {
  exactKeys(runIdentity, ["provider", "runAttempt", "runId"], label);

  if (
    !["github-actions", "local"].includes(runIdentity.provider) ||
    typeof runIdentity.runId !== "string" ||
    runIdentity.runId.length === 0 ||
    typeof runIdentity.runAttempt !== "string" ||
    !/^[1-9][0-9]*$/u.test(runIdentity.runAttempt)
  ) {
    throw new Error(`${label} is invalid`);
  }

  return true;
}

export function verifyHash(value, label) {
  if (typeof value !== "string" || !HASH.test(value)) throw new Error(`${label} is invalid`);
}

export function verifyCommit(value, label) {
  if (typeof value !== "string" || !COMMIT.test(value)) throw new Error(`${label} is invalid`);
}
