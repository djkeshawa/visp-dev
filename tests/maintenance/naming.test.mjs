/**
 * R0, enforced. One naming convention, whole repository.
 *
 * The convention is only worth writing down if something fails when it is
 * broken. Every rule below reports the offending path, the rule it broke, and
 * the name it should have had — a checker that says "invalid name" and stops
 * makes people delete the checker.
 *
 * This file itself has no source module to mirror, which rule 6 would forbid.
 * It is in `DECLARED_OUTSIDE_UNIT` below, and so is every other suite that does
 * not sit at the unit level. That list is the whole point of the exemption:
 * adding to it is a deliberate, reviewable act, and forgetting to add to it
 * fails the build.
 */
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const SKIP_DIRECTORIES = new Set(["node_modules", ".git", ".scratch", "coverage"]);

/**
 * The one exemption R0 grants: package.json `bin` publishes this path and it
 * carries the product's own name.
 */
const EXEMPT_PATHS = new Set(["scripts/visp-dev.mjs"]);

const SEGMENT = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/u;

/**
 * Rule 4: the directory already means "entrypoint" and the npm script name
 * already carries the verb.
 */
const REMOVED_VERB_PREFIXES = [
  "run-",
  "generate-",
  "check-",
  "measure-",
  "derive-",
  "capture-",
  "assemble-",
  "scan-",
  "record-",
  "freeze-",
];

/**
 * The levels `tests/` is allowed to hold, and the scaffolding that is not a
 * level. `functional/` and `regression/` belong to QE and are listed before
 * they exist, so the first one written lands in the right place instead of
 * inventing a tenth folder.
 */
const LEVELS = new Set(["unit", "integration", "functional", "regression"]);
const SCAFFOLDING = new Set(["helpers", "fixtures", "support", "setup"]);

/**
 * Repository conformance suites, which check the repository rather than a
 * level of the pyramid, and are therefore allowed a folder of their own.
 */
const CONFORMANCE = "maintenance";

/**
 * Every test file that is NOT at the unit level, declared one by one.
 *
 * Each entry is a claim that the file belongs where it sits. `seams` compares
 * SIBLING REPOSITORIES against each other and has no local source at all;
 * `hostile-paths` drives the published binary end to end; `documentation`
 * checks prose. Anything not listed here must live under `tests/unit/` and
 * mirror its module, so a stray test file cannot accumulate unnoticed.
 */
const DECLARED_OUTSIDE_UNIT = new Set([
  "tests/integration/cli/argv.test.mjs",
  "tests/integration/cli/hostile-paths.test.mjs",
  "tests/integration/compatibility/lab.test.mjs",
  "tests/maintenance/documentation.test.mjs",
  "tests/maintenance/naming.test.mjs",
  "tests/maintenance/seams.test.mjs",
  "tests/maintenance/workspace-layout.test.mjs",
]);

function walk(relativeDirectory) {
  const absolute = path.join(repositoryRoot, relativeDirectory);
  const out = [];
  let entries;
  try {
    entries = readdirSync(absolute, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const relative = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(relative));
    else out.push(relative);
  }
  return out;
}

const GOVERNED_ROOTS = ["src", "scripts", "tests"];
const governedFiles = GOVERNED_ROOTS.flatMap((root) => walk(root));
const governedModules = governedFiles.filter((file) => file.endsWith(".mjs"));

function suggestedName(basename) {
  const extension = path.extname(basename);
  const stem = basename.slice(0, basename.length - extension.length);
  return (
    stem
      .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
      .replace(/_/gu, "-")
      .toLowerCase()
      .replace(/[^a-z0-9-]/gu, "-")
      .replace(/-+/gu, "-")
      .replace(/^-|-$/gu, "") + extension
  );
}

test("rule 1: every path segment under src, scripts and tests is kebab-case", () => {
  const offenders = [];
  for (const file of governedFiles) {
    if (EXEMPT_PATHS.has(file)) continue;
    const segments = file.split("/");
    for (const [index, segment] of segments.entries()) {
      const last = index === segments.length - 1;
      // A filename carries extensions (`.test.mjs`); a directory does not.
      const stem = last ? segment.split(".")[0] : segment;
      if (!SEGMENT.test(stem)) {
        offenders.push(
          `${file}\n      segment "${segment}" breaks rule 1 (kebab-case, lowercase, ` +
            `^[a-z][a-z0-9]*(-[a-z0-9]+)*$). Rename it to "${last ? suggestedName(segment) : suggestedName(segment)}".`,
        );
      }
    }
  }
  assert.deepEqual(offenders, [], `R0 rule 1 broken:\n  - ${offenders.join("\n  - ")}`);
});

test("rule 4: no .mjs under src or scripts carries a removed verb prefix", () => {
  const offenders = [];
  for (const file of governedModules) {
    if (EXEMPT_PATHS.has(file)) continue;
    if (!file.startsWith("src/") && !file.startsWith("scripts/")) continue;
    const basename = path.basename(file);
    const prefix = REMOVED_VERB_PREFIXES.find((candidate) => basename.startsWith(candidate));
    if (prefix !== undefined) {
      offenders.push(
        `${file}\n      breaks rule 4 (no verb prefixes). Drop "${prefix}" and let the npm ` +
          `script carry the verb: "${path.dirname(file)}/${basename.slice(prefix.length)}".`,
      );
    }
  }
  assert.deepEqual(offenders, [], `R0 rule 4 broken:\n  - ${offenders.join("\n  - ")}`);
});

test("rule 7: no phase number survives anywhere in a path", () => {
  // The rename table is a rename, not an alias. A name says what a thing is,
  // not which attempt produced it — and `phase-2` in a path is how a reader
  // learns the ordering matters when it does not.
  const offenders = governedFiles
    .filter((file) => /phase-\d/u.test(file))
    .map((file) => `${file}\n      breaks rule 7 (no phase numbers). Rename it for what it proves.`);
  assert.deepEqual(offenders, [], `R0 rule 7 broken:\n  - ${offenders.join("\n  - ")}`);
});

test("rule 6: every unit test mirrors its source module, or is declared outside unit", () => {
  const offenders = [];
  for (const file of governedFiles) {
    if (!file.endsWith(".test.mjs")) continue;
    if (file.startsWith("tests/helpers/")) continue;
    if (DECLARED_OUTSIDE_UNIT.has(file)) continue;

    if (!file.startsWith("tests/unit/")) {
      offenders.push(
        `${file}\n      breaks rule 6. A test file is either a mirror under tests/unit/ or a ` +
          "declared entry in DECLARED_OUTSIDE_UNIT in this file, with a reason.",
      );
      continue;
    }

    // The mirror is src/ and only src/. An entry point is driven from
    // tests/integration/, where the folder names the surface, not the module.
    const mirror = path.join("src", file.replace(/^tests\/unit\//u, "").replace(/\.test\.mjs$/u, ".mjs"));
    let found = false;
    try {
      found = statSync(path.join(repositoryRoot, mirror)).isFile();
    } catch {
      found = false;
    }
    if (!found) {
      offenders.push(
        `${file}\n      breaks rule 6 (tests/unit/ mirrors src/ exactly). Expected ${mirror}. ` +
          "Either rename the test to match its module, or — if it is not a unit test — move it to " +
          "its level and add it to DECLARED_OUTSIDE_UNIT in this file with a reason.",
      );
    }
  }
  assert.deepEqual(offenders, [], `R0 rule 6 broken:\n  - ${offenders.join("\n  - ")}`);
});

test("rule 6: tests/ holds levels and scaffolding, and nothing else", () => {
  // The pyramid decayed once already, into nine folders grouped by domain. A
  // level is a directory a reader can name before opening it; a tenth folder
  // invented on the way past is how the grouping drifts back to domain.
  const allowed = new Set([...LEVELS, ...SCAFFOLDING, CONFORMANCE]);
  const offenders = [...new Set(governedFiles
    .filter((file) => file.startsWith("tests/"))
    .map((file) => file.split("/")[1]))]
    .filter((top) => !allowed.has(top))
    .map(
      (top) =>
        `tests/${top}/\n      breaks rule 6. tests/ holds one directory per level ` +
        `(${[...LEVELS].join(", ")}), shared scaffolding (${[...SCAFFOLDING].join(", ")}), and ` +
        `${CONFORMANCE}/ for suites that check the repository itself. Put it inside a level.`,
    );
  assert.deepEqual(offenders, [], `R0 rule 6 broken:\n  - ${offenders.join("\n  - ")}`);
});

test("rule 6: nothing lives under tests/ except mirrors and tests/helpers/", () => {
  const offenders = governedFiles
    .filter((file) => file.startsWith("tests/"))
    .filter((file) => !file.endsWith(".test.mjs") && !file.startsWith("tests/helpers/"))
    .map(
      (file) =>
        `${file}\n      breaks rule 6. A file under tests/ is either a *.test.mjs mirror of a ` +
        "source module or a fixture under tests/helpers/.",
    );
  assert.deepEqual(offenders, [], `R0 rule 6 broken:\n  - ${offenders.join("\n  - ")}`);
});

test("the exemptions are real files, so the list cannot rot unnoticed", () => {
  // An exemption naming a path that no longer exists is a rule quietly switched
  // off for a file somebody already renamed.
  for (const relative of [...EXEMPT_PATHS, ...DECLARED_OUTSIDE_UNIT]) {
    assert.ok(
      statSync(path.join(repositoryRoot, relative), { throwIfNoEntry: false })?.isFile(),
      `${relative} is exempted from R0 but does not exist. Remove the exemption.`,
    );
  }
});
