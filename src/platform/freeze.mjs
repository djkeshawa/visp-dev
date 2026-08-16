/**
 * The one `deepFreeze`.
 *
 * Six files carried a byte-identical private copy: the four suite modules, the
 * matrix, and the release-evidence module. Every one of them guards a pinned
 * `*_DEFINITION` whose hash is asserted elsewhere, so a copy that drifted would
 * let a definition be mutated in place after its hash had been taken.
 */
export function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
