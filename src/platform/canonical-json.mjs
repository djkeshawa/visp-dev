/**
 * TWO canonical serialisations. THEY MUST NEVER BE MERGED.
 *
 * | export                       | serialisation                              |
 * |------------------------------|--------------------------------------------|
 * | `canonicalise` / `hashOf`    | compact, no whitespace                     |
 * | `canonicalStringify` / `sha256Hex` | `JSON.stringify(sorted, null, 2) + "\n"` |
 *
 * Both sort object keys at every depth and leave arrays in their own order, so
 * both are canonical. They produce DIFFERENT strings for the same value and
 * therefore different digests. `tests/unit/platform/canonical-json.test.mjs` asserts
 * that they differ, because "these two functions look the same, delete one" is
 * the single most damaging change available in this file.
 *
 * What each digest is already committed to:
 *   - `hashOf` — holdout record hashes, manifest hashes, ablation report hashes.
 *   - `sha256Hex(canonicalStringify(x))` — compatibility report bytes and every
 *     `*_DEFINITION` pin, including the phase-6 hash asserted by
 *     `tests/maintenance/documentation.test.mjs` against `docs/compatibility.md`.
 * Converging the recipes would silently invalidate one whole population of
 * digests while every test that recomputes both sides still passed.
 *
 * THE DEFECT `canonicalise` EXISTS TO KILL. Every RECORD hash in this workspace
 * used to be computed as
 *
 *     createHash("sha256").update(JSON.stringify(rest, Object.keys(rest).sort()))
 *
 * The second argument to `JSON.stringify` is a REPLACER. When it is an array it
 * is an allow-list of property names applied at EVERY depth, not a key order for
 * the top level. `Object.keys(rest)` names only top-level keys, so every nested
 * key was filtered out and `task`, `groundTruth` and `provenance` all serialised
 * as `{}`. The digest covered the record's top-level scalars and nothing else.
 *
 * What that cost, measured rather than argued: a holdout record's entire answer
 * key could be rewritten and the hash still verified, and `provenance.author`
 * could be flipped on seven records without producing a single mismatch — which
 * moved seven records into the capability cohort with the harness reporting
 * clean. Any hash computed by the old recipe proved that the top-level scalars
 * were unedited. It proved nothing about any nested field.
 */
import { createHash } from "node:crypto";

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursively key-sorted, whitespace-free JSON. Arrays keep their order.
 *
 * Every branch is written out rather than delegated to `JSON.stringify` on the
 * whole value, because the whole point of this recipe is that a single
 * delegation with a subtle second argument is what broke the last one.
 *
 * `undefined` is treated exactly as `JSON.stringify` treats it — dropped as an
 * object property, `null` in an array, `null` at the root — so that
 * `canonicalise(x)` and `canonicalise(JSON.parse(JSON.stringify(x)))` agree.
 * They must agree: a record is hashed in memory when it is built and re-hashed
 * after a round trip through disk.
 */
export function canonicalise(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalise(entry)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const pairs = [];
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      pairs.push(`${JSON.stringify(key)}:${canonicalise(value[key])}`);
    }
    return `{${pairs.join(",")}}`;
  }
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      // NaN and ±Infinity become `null` under JSON.stringify, which would make
      // three distinct values hash identically. Refuse instead.
      if (!Number.isFinite(value)) {
        throw new TypeError(`canonicalise: ${String(value)} is not representable in JSON`);
      }
      return JSON.stringify(value);
    default:
      // bigint, symbol, function. JSON.stringify would throw on the first and
      // silently drop the other two; silent dropping is exactly the failure
      // mode this recipe was written to end.
      throw new TypeError(`canonicalise: cannot hash a value of type ${typeof value}`);
  }
}

/** sha256 over the COMPACT canonical serialisation. Record and manifest hashes. */
export function hashOf(value) {
  return createHash("sha256").update(canonicalise(value)).digest("hex");
}

/**
 * The recipe string a manifest, record or report carries so a reader can
 * reproduce the digest without reading this file.
 */
export const CANONICAL_HASH_RECIPE =
  "sha256 over a canonical JSON serialisation: object keys sorted at EVERY depth, " +
  "arrays in their own order, no whitespace, the hash field itself removed before hashing";

/**
 * The recipe that used to be used, kept only so a verifier can SAY what an old
 * digest was and was not evidence of. Nothing computes a new hash with it.
 */
export const BROKEN_ARRAY_REPLACER_RECIPE =
  "sha256 over JSON.stringify(record, Object.keys(record).sort()) — an ARRAY REPLACER, " +
  "which filters keys at every depth, so every nested object serialised as {} and the " +
  "digest covered top-level scalars only";

/**
 * Key-sorted plain JSON VALUE. Arrays keep their order.
 *
 * R2, measured: key-shuffling a `*_DEFINITION` leaves its hash identical;
 * reversing one array element changes it. Every pinned definition in this
 * repository depends on exactly that asymmetry.
 */
function sortJson(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON accepts only finite numbers");
    return value;
  }
  if (typeof value !== "object" || seen.has(value)) {
    throw new TypeError("Canonical JSON accepts only acyclic JSON values");
  }
  seen.add(value);
  let sorted;
  if (Array.isArray(value)) {
    sorted = value.map((entry) => sortJson(entry, seen));
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError("Canonical JSON accepts only plain objects");
    }
    sorted = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new TypeError("Canonical JSON does not accept undefined");
      sorted[key] = sortJson(value[key], seen);
    }
  }
  seen.delete(value);
  return sorted;
}

/**
 * PRETTY canonical JSON: two-space indent, trailing newline. Report bytes.
 *
 * The trailing newline and the indent are part of the digest. Removing either
 * to "tidy up" changes every `*_DEFINITION` pin in the repository.
 */
export function canonicalStringify(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

/** sha256 over an already-serialised string or buffer. */
export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
