/**
 * The only version arithmetic an offline install lock is allowed to need.
 *
 * Deliberately not a semver implementation. A lock this laboratory accepts
 * pins exact stable versions and authors dependencies as an exact version or a
 * caret range; anything else — a prerelease, a hyphen range, an `x` — is
 * refused rather than interpreted. A partial semver parser that silently
 * mishandled a range would resolve a graph the installer would not, and the
 * whole point of validating the lock is that the two agree.
 */

const STABLE_EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export function parseStableExactVersion(version) {
  if (typeof version !== "string") throw new Error("Offline install lock package versions must be stable exact versions");
  const match = STABLE_EXACT_VERSION.exec(version);
  if (!match) {
    if (/^\d+\.\d+\.\d+-/u.test(version)) {
      throw new Error("Offline install lock prerelease package versions are unsupported");
    }
    throw new Error("Offline install lock package versions must be stable exact versions");
  }
  const components = match.slice(1).map(Number);
  if (components.some((component) => !Number.isSafeInteger(component))) {
    throw new Error("Offline install lock package version exceeds the supported numeric bound");
  }
  return components;
}

export function validateExactVersion(version) {
  parseStableExactVersion(version);
  return version;
}

/** An exact pin or a caret range, resolved to a half-open `[lower, upper)`. */
export function parseAuthoredDependencySpec(spec) {
  if (typeof spec !== "string") throw new Error("Offline install lock contains an unsupported dependency spec");
  const caret = spec.startsWith("^");
  const versionText = caret ? spec.slice(1) : spec;
  if (/^\d+\.\d+\.\d+-/u.test(versionText)) {
    throw new Error("Offline install lock prerelease dependency specs are unsupported");
  }
  if (!STABLE_EXACT_VERSION.test(versionText)) {
    throw new Error("Offline install lock contains an unsupported dependency spec");
  }
  const lower = parseStableExactVersion(versionText);
  if (!caret) return { kind: "exact", lower, upper: lower };
  const [major, minor, patch] = lower;
  // Caret below 1.0.0 is narrower than "same major": npm treats ^0.2.3 as
  // >=0.2.3 <0.3.0 and ^0.0.3 as >=0.0.3 <0.0.4.
  const upper = major > 0
    ? [major + 1, 0, 0]
    : minor > 0
      ? [0, minor + 1, 0]
      : [0, 0, patch + 1];
  if (upper.some((component) => !Number.isSafeInteger(component))) {
    throw new Error("Offline install lock dependency spec exceeds the supported numeric bound");
  }
  return { kind: "caret", lower, upper };
}

export function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

export function versionSatisfiesSpec(version, spec) {
  const candidate = parseStableExactVersion(version);
  const parsed = parseAuthoredDependencySpec(spec);
  if (parsed.kind === "exact") return compareVersions(candidate, parsed.lower) === 0;
  return compareVersions(candidate, parsed.lower) >= 0 && compareVersions(candidate, parsed.upper) < 0;
}

export function validatePackageName(name) {
  if (typeof name !== "string"
    || !/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u.test(name)) {
    throw new Error("Offline install lock contains an invalid package name");
  }
  return name;
}
