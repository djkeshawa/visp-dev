/**
 * The closed-shape guards, once.
 *
 * `plainObject`/`exactKeys` were duplicated verbatim across six modules, and
 * `HASH`/`PREFIXED_HASH`/`COMMIT` across four. The duplication was not free:
 * `exactKeys` is what makes a report shape CLOSED, so a copy that fell behind
 * would accept a field the schema no longer allows in exactly one suite and
 * nowhere else — a hole visible only by diffing six files.
 *
 * Every check here fails closed and names the value that failed.
 */
import { canonicalStringify } from "./canonical-json.mjs";

/** A bare sha256 digest. */
export const HASH = /^[0-9a-f]{64}$/u;
/** A digest carrying its algorithm, as report bindings record it. */
export const PREFIXED_HASH = /^sha256:[0-9a-f]{64}$/u;
/** A full 40-character Git object ID. Abbreviations are refused everywhere. */
export const COMMIT = /^[0-9a-f]{40}$/u;

/**
 * A plain object and nothing else — not null, not an array, not a class
 * instance. The prototype check is deliberate: a value from `JSON.parse` has
 * `Object.prototype`, and anything that does not came from code rather than
 * from the document under inspection.
 */
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

/** Exactly these keys, no more and no fewer. This is what makes a shape closed. */
export function exactKeys(value, keys, label) {
  plainObject(value, label);

  if (canonicalStringify(Object.keys(value).sort()) !== canonicalStringify([...keys].sort())) {
    throw new Error(`${label} has an unexpected field set`);
  }
}

/**
 * Deep equality against a frozen expectation.
 *
 * `drift` is the caller's own sentence because the message names WHICH pin
 * moved, and a generic "value differs" would make a definition drift read like
 * an ordinary assertion failure.
 */
export function exactValue(actual, expected, label, drift = "drifted from its frozen definition") {
  if (canonicalStringify(actual) !== canonicalStringify(expected)) {
    throw new Error(`${label} ${drift}`);
  }
}

/** An array, deep-equal to a frozen expectation, in order. */
export function exactArray(value, expected, label, drift = "does not match the frozen matrix") {
  if (!Array.isArray(value) || canonicalStringify(value) !== canonicalStringify(expected)) {
    throw new Error(`${label} ${drift}`);
  }
}

export function verifyHash(value, label) {
  if (typeof value !== "string" || !HASH.test(value)) throw new Error(`${label} is invalid`);
}

export function verifyCommit(value, label) {
  if (typeof value !== "string" || !COMMIT.test(value)) throw new Error(`${label} is invalid`);
}
