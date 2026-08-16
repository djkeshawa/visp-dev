/**
 * The envelope every pinned suite report carries, sealed and opened once. Each
 * suite's own `validation.mjs` adds the rest of what a report of that suite
 * must satisfy before it counts as evidence.
 *
 * Four suites each wrote the same six lines: attach `definitionSha256` and
 * `schemaVersion`, hash the report without its own hash field, then re-verify
 * by deleting that field and recomputing. Two of the four also had to remember
 * that the hash is taken over the report MINUS `reportSha256` — a copy that
 * hashed the whole object would have produced a document that could never
 * verify, and only that suite's own tests would have noticed.
 *
 * `sealReport` and `openReport` are inverses by construction, so a suite cannot
 * seal with one recipe and verify with another.
 */
import { canonicalStringify, sha256Hex } from "../../platform/canonical-json.mjs";
import { HASH, exactKeys } from "../../platform/shape.mjs";

/**
 * Runtime content that must never reach a report: an owned-root path, a clock
 * reading, or a duration makes the document unreproducible, so a second run
 * cannot contradict the first.
 */
const UNSTABLE_CONTENT = /visp-compatibility-lab-|timestamp|generatedAt|checkedAt|duration|\/tmp\//iu;

/**
 * Attaches the suite identity, then the content hash over everything else.
 *
 * The digest covers the document WITHOUT its own hash field, because the field
 * cannot exist while it is being computed. `openReport` deletes it and hashes
 * again, so the two are inverses by construction rather than by convention.
 */
export function sealReport(suite, body) {
  const report = {
    ...body,
    definitionSha256: suite.sha256,
    schemaVersion: suite.reportKind,
  };
  report.reportSha256 = sha256Hex(canonicalStringify(report));
  return report;
}

/** Re-derives the digest and refuses a document whose content has moved. */
export function openReport(suite, report, fields) {
  exactKeys(report, fields, `${suite.id} report`);
  if (report.schemaVersion !== suite.reportKind
    || report.definitionSha256 !== suite.sha256
    || !HASH.test(report.reportSha256 ?? "")) {
    throw new Error(`${suite.id} report identity is invalid`);
  }
  const unhashed = structuredClone(report);
  delete unhashed.reportSha256;
  if (report.reportSha256 !== sha256Hex(canonicalStringify(unhashed))) {
    throw new Error(`${suite.id} report hash does not match its content`);
  }
  return true;
}

/** The last check every suite runs: nothing unreproducible got into the bytes. */
export function assertStableContent(suite, report) {
  if (UNSTABLE_CONTENT.test(canonicalStringify(report))) {
    throw new Error(`${suite.id} report contains unstable runtime content`);
  }
  return true;
}
