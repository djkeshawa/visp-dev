/**
 * Ordering version strings numerically, because text ordering gets it wrong.
 *
 * Every version this repository handles arrives as a string a binary printed or
 * a hand-maintained matrix declared, and the questions asked of them are always
 * comparisons: does this Node clear the floor, is the installed pair newer than
 * the one the registry serves. Doing that by string comparison or by
 * `parseInt` on the leading digits gives right answers often enough to hide the
 * wrong ones — `"9" > "22"` as text, and a `>=22.5.0` floor reads as `22` once
 * the minor is truncated, so 22.1.0 passes a floor it is below.
 *
 * Pre-releases follow SemVer: a pre-release sorts BELOW the release it precedes,
 * so v22.0.0-rc.1 does not satisfy >=22. It is the honest answer — an rc is not
 * the release — and it is the one Node's own nightlies need.
 *
 * Nothing here reads the matrix or the machine. It compares two strings.
 */

/** The first version-shaped token in `text`: `v26.7.0`, `>=22`, `22.5.0-rc.1`. */
function versionToken(text) {
  const match = /(\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?)/u.exec(`${text ?? ""}`);
  return match === null ? null : match[1];
}

/**
 * `{ major, minor, patch, prerelease }`, or null when there is no version in
 * `text`. Absent minor and patch are zero, so `22` and `22.0.0` are one value.
 */
export function parseVersion(text) {
  const token = versionToken(text);
  if (token === null) return null;

  const hyphen = token.indexOf("-");
  const core = hyphen === -1 ? token : token.slice(0, hyphen);
  const prerelease = hyphen === -1 ? null : token.slice(hyphen + 1);
  const parts = core.split(".").map((part) => Number.parseInt(part, 10));

  if (parts.some((part) => !Number.isInteger(part))) return null;

  return { major: parts[0], minor: parts[1] ?? 0, patch: parts[2] ?? 0, prerelease };
}

/** SemVer §11: numeric identifiers compare numerically and rank below alphanumeric ones. */
function comparePrerelease(left, right) {
  if (left === null && right === null) return 0;
  // A release outranks any pre-release of the same core version.
  if (left === null) return 1;
  if (right === null) return -1;

  const leftParts = left.split(".");
  const rightParts = right.split(".");

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const a = leftParts[index];
    const b = rightParts[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;

    const aNumeric = /^\d+$/u.test(a);
    const bNumeric = /^\d+$/u.test(b);
    if (aNumeric && bNumeric) {
      if (Number(a) !== Number(b)) return Number(a) < Number(b) ? -1 : 1;
      continue;
    }
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    if (a !== b) return a < b ? -1 : 1;
  }

  return 0;
}

/** -1, 0 or 1 — or null when either side carries no version to compare. */
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a === null || b === null) return null;

  for (const field of ["major", "minor", "patch"]) {
    if (a[field] !== b[field]) return a[field] < b[field] ? -1 : 1;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

/**
 * Whether `version` clears the floor `requirement` states.
 *
 * The matrix only ever expresses a floor, written `>=22` or bare. Anything else
 * — a ceiling, a caret, a union — returns null rather than being read as a
 * floor, because reading `<25` as "at least 25" would approve exactly the
 * machines it excludes. An unrecognised requirement is unknown, not satisfied.
 */
export function satisfiesFloor(version, requirement) {
  const text = `${requirement ?? ""}`.trim();
  if (!/^(?:>=\s*)?v?\d/u.test(text)) return null;

  const order = compareVersions(version, text);
  return order === null ? null : order >= 0;
}

/** Whether `candidate` is strictly newer than `reference`; false when unknown. */
export function isNewerThan(candidate, reference) {
  return (compareVersions(candidate, reference) ?? 0) > 0;
}
