/**
 * R5 as executable code: a suite may import only from `engine/`, `platform/`
 * and `toolchain/`.
 *
 * Before this existed, `additive-enforcement-fixes` imported eight symbols out
 * of `mixed-generation-negotiation`, and `published-artifact-differential`
 * imported a journey out of `additive-enforcement-fixes`. That made an older
 * suite's pinned module a library for a newer one: editing the old pin's helper
 * silently changed what the new pin proved, and nothing said so.
 *
 * The scan is over SOURCE TEXT, not the module graph, so it reports the import
 * statement itself — before anything executes, and whether or not the offending
 * path is reachable at runtime.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SUITES_ROOT = fileURLToPath(new URL("../suites/", import.meta.url));

const STATIC_SPECIFIER = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/gu;
const DYNAMIC_SPECIFIER = /\bimport\(\s*["']([^"']+)["']\s*\)/gu;

/** Every relative and bare specifier a module names, static or dynamic. */
export function importSpecifiers(source) {
  return [
    ...[...source.matchAll(STATIC_SPECIFIER)].map((match) => match[1]),
    ...[...source.matchAll(DYNAMIC_SPECIFIER)].map((match) => match[1]),
  ];
}

export function suiteNames(root = SUITES_ROOT) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function moduleFiles(directory, prefix = "") {
  const out = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...moduleFiles(path.join(directory, entry.name), relative));
    else if (entry.name.endsWith(".mjs")) out.push(relative);
  }
  return out;
}

/**
 * Which suite a relative specifier reaches into, or `null` if it stays outside
 * `suites/` entirely — which is the normal, allowed case.
 */
export function suiteReachedBy(fromFile, specifier, root = SUITES_ROOT) {
  if (!specifier.startsWith(".")) return null;
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  if (!resolved.startsWith(root)) return null;
  return path.relative(root, resolved).split(path.sep)[0];
}

/** One sentence per violation, naming the file, the import, and the fix. */
export function suiteImportViolations(root = SUITES_ROOT) {
  const offenders = [];
  for (const suite of suiteNames(root)) {
    const suiteRoot = path.join(root, suite);
    for (const file of moduleFiles(suiteRoot)) {
      const absolute = path.join(suiteRoot, file);
      for (const specifier of importSpecifiers(readFileSync(absolute, "utf8"))) {
        const reached = suiteReachedBy(absolute, specifier, root);
        if (reached !== null && reached !== suite) {
          offenders.push(
            `suites/${suite}/${file} imports "${specifier}", which resolves into the ` +
              `${reached} suite. A suite may import only from engine/, platform/ and ` +
              "toolchain/ — move the shared code into src/compatibility/engine/.",
          );
        }
      }
    }
  }
  return offenders;
}

/**
 * Anything a suite imports that is not itself, `engine/`, `platform/` or
 * `toolchain/`. Catches a reach into `matrix/`, `fixtures/` or `registry/`,
 * which `suiteImportViolations` alone would not.
 */
const ALLOWED_OUTSIDE = /^(?:\.\.\/)+(?:compatibility\/)?engine\/|^(?:\.\.\/)+platform\/|^(?:\.\.\/)+toolchain\//u;

export function suiteReachViolations(root = SUITES_ROOT) {
  const offenders = [];
  for (const suite of suiteNames(root)) {
    const suiteRoot = path.join(root, suite);
    for (const file of moduleFiles(suiteRoot)) {
      const absolute = path.join(suiteRoot, file);
      for (const specifier of importSpecifiers(readFileSync(absolute, "utf8"))) {
        if (!specifier.startsWith(".")) continue;
        if (specifier.startsWith("./")) continue;
        if (ALLOWED_OUTSIDE.test(specifier)) continue;
        offenders.push(`suites/${suite}/${file} imports "${specifier}"`);
      }
    }
  }
  return offenders;
}
