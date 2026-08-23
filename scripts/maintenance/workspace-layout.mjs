#!/usr/bin/env node
/**
 * Say why this checkout cannot pass, BEFORE it tries.
 *
 * QE cloned visp-dev on its own and ran the suite. Seven tests failed. Nothing
 * was wrong with the clone and nothing was wrong with the change under test:
 * `tests/seams.test.mjs` compares this repository's SIBLINGS against each
 * other, and in a lone clone there is nothing to compare. The dependency is
 * legitimate — the seam tests exist because the last four escaped defects lived
 * between packages, so a missing sibling has to fail rather than skip — but the
 * explanation arrived after seven stack traces, in the middle of the output,
 * once per test. A reader's first hypothesis was that they had broken something.
 *
 * So the explanation moves to the top. `pretest` runs this, it prints the
 * layout the suite requires and what is missing from it, and then the suite
 * runs.
 *
 * IT EXITS ZERO ON PURPOSE. Aborting the run would hide the ~383 tests that a
 * lone clone passes perfectly well, and those are most of the value of running
 * the suite at all. The seam tests still fail; this only makes sure the reason
 * is the first thing on screen rather than the last thing inferred.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * The siblings `tests/seams.test.mjs` reads. Nothing else needs one.
 *
 * llm-memory joined this list late, and the way it was missing is the reason
 * `locateProduct` now refuses an unregistered name. The Hyper<->Memory seam
 * resolved llm-memory with its own inline candidate loop, so the preflight
 * could not see the dependency: a clone with the two siblings named here and
 * in the README was told "found", exited zero, and then failed a seam test for
 * a directory nothing had mentioned. That is the failure this file exists to
 * prevent, produced by this file's own blind spot.
 */
export const REQUIRED_SIBLINGS = Object.freeze([
  "visp-kit",
  "visp-hyper-agent",
  "llm-memory"
]);

/**
 * The file that proves a directory is the product and not an empty folder that
 * happens to share its name. Per product rather than assumed, because
 * llm-memory is Python: it carries a `pyproject.toml` and no `package.json`,
 * and a hardcoded `package.json` probe would report it missing while it sat
 * right there.
 */
const PRODUCT_MANIFESTS = Object.freeze({
  "visp-kit": "package.json",
  "visp-hyper-agent": "package.json",
  "llm-memory": "pyproject.toml"
});

/**
 * The manifest proving `name` — and a hard error for a name nobody registered.
 *
 * Refusing is the point: a seam that needs a new sibling cannot resolve it
 * without adding it here, where the banner and the README test can both see it.
 */
export function manifestFileFor(name) {
  if (!Object.hasOwn(PRODUCT_MANIFESTS, name)) {
    throw new Error(
      `No sibling product is registered under "${name}", so the preflight cannot report it as ` +
        "missing and the banner would promise a full pass this checkout cannot reach. Add it to " +
        "REQUIRED_SIBLINGS and PRODUCT_MANIFESTS in scripts/maintenance/workspace-layout.mjs, and to " +
        'the layout under "Workspace layout the suite requires" in README.md.'
    );
  }
  return PRODUCT_MANIFESTS[name];
}

/** The suite that cannot run without them. */
export const SEAM_TEST_FILE = "tests/maintenance/seams.test.mjs";

/**
 * Where a sibling may live: next to this repository in a workspace checkout, or
 * vendored under `engines/` in CI. Both are supported, so both are searched and
 * both are named when neither exists — "not found" without "here is where I
 * looked" is a message that cannot be acted on.
 */
export function candidatePathsFor(name, devRoot) {
  return [path.join(devRoot, "..", name), path.join(devRoot, "engines", name)];
}

/**
 * The resolved root of a sibling, or `null`. Its manifest is the proof.
 *
 * THE ONLY WAY to turn a sibling's name into a path. `tests/seams.test.mjs`
 * calls this and nothing else, so the banner at the top of the run and the
 * failures at the bottom are always talking about the same directories.
 * Throws for an unregistered name — see `manifestFileFor`.
 */
export function locateProduct(name, devRoot) {
  const manifest = manifestFileFor(name);
  for (const candidate of candidatePathsFor(name, devRoot)) {
    if (existsSync(path.join(candidate, manifest))) return candidate;
  }
  return null;
}

/**
 * The short commit a sibling is checked out at, or `null`.
 *
 * LC-76: CI checks the three siblings out at their DEFAULT BRANCH TIPS, with no
 * `ref:`. That is the correct semantic for a seam product — a pin would freeze
 * the comparison and defeat the drift detection the seams exist for — but it
 * means a push to visp-kit can turn this repository's matrix red with no
 * visp-dev change, and nothing in the failure says which repository moved.
 * Recording the revision here is what lets the reader tell.
 *
 * Null on any failure: an `engines/` copy vendored by a tarball or a fixture is
 * a legitimate sibling with no git history, and a preflight that crashed over a
 * missing `.git` would block a run it exists to explain.
 *
 * THE OWN-REPOSITORY CHECK IS THE WHOLE POINT. `git -C` walks UP the directory
 * tree, so a vendored `engines/visp-kit` carrying no `.git` of its own resolves
 * against visp-dev's repository and answers with visp-dev's HEAD. The banner
 * would then print `visp-kit@<visp-dev's commit>` and invite the reader to
 * blame a sibling for this repository's own change — the exact misdiagnosis
 * this revision exists to prevent, delivered with more confidence than before.
 *
 * The check is the presence of `.git`, not a comparison against
 * `rev-parse --show-toplevel`. That comparison was the first attempt and it
 * failed every Windows leg: git answers with forward slashes and a long path,
 * `mkdtemp` hands back backslashes, and the two never matched however they were
 * canonicalised — so a real sibling checkout reported NO revision, which is the
 * failure this function exists to avoid, arrived at from the other side.
 * Asking whether the directory carries its own `.git` is the actual question,
 * costs no subprocess when the answer is no, and has no path-shape opinion at
 * all. A worktree or submodule carries `.git` as a FILE, which is still its own
 * repository and still answers for itself, so `existsSync` is the right probe
 * rather than a directory test.
 */
export function revisionOf(root) {
  if (!existsSync(path.join(root, ".git"))) return null;

  try {
    return execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim() || null;
  } catch {
    return null;
  }
}

export function workspaceLayout(devRoot) {
  const found = [];
  const missing = [];
  for (const name of REQUIRED_SIBLINGS) {
    const root = locateProduct(name, devRoot);
    if (root === null) missing.push({ name, looked: candidatePathsFor(name, devRoot) });
    else found.push({ name, root, revision: revisionOf(root) });
  }
  return { devRoot, found, missing, satisfied: missing.length === 0 };
}

/** `visp-kit@1a2b3c4`, or the bare name when the checkout has no git history. */
function describeSibling(entry) {
  // Absent and null both mean "no revision to name": `layoutBanner` is exported
  // and gets hand-built layouts, and `(undefined)` in the banner would be worse
  // than saying nothing.
  return entry.revision ? `${entry.name}@${entry.revision}` : entry.name;
}

/**
 * How many tests are about to fail for this reason.
 *
 * Counted from the file rather than written down, because a hardcoded seven
 * would be wrong the first time somebody adds a seam and nobody would notice —
 * a stale number in an explanatory message is how the message stops being
 * believed. Counted by the `SEAM:` name prefix rather than by `test(`, so a
 * test that lives in that file without depending on a sibling is not counted
 * among the ones this predicts will fail. Returns `null` when the file cannot
 * be read or the naming moved, and the banner then declines to give a number
 * rather than inventing one.
 */
export function countSeamTests(devRoot) {
  try {
    const source = readFileSync(path.join(devRoot, SEAM_TEST_FILE), "utf8");
    const count = (source.match(/^test\("SEAM:/gmu) ?? []).length;
    return count > 0 ? count : null;
  } catch {
    return null;
  }
}

const RULE = "=".repeat(78);

export function layoutBanner(layout, { seamTestCount = null } = {}) {
  if (layout.satisfied) {
    const names = layout.found.map(describeSibling).join(", ");
    const line = `workspace layout: ${names} found; the seam tests have something to compare.`;

    // Only claim the revisions when some were printed. A tarball-vendored
    // sibling has no history to name, and a banner pointing at "those exact
    // revisions" while naming none is the kind of sentence a reader stops
    // believing the second time they check it.
    return layout.found.every((entry) => !entry.revision)
      ? line
      : `${line}\nseam comparisons are against the revisions named above: a seam failure may be a ` +
        "sibling's commit rather than this repository's.";
  }

  const width = Math.max(...REQUIRED_SIBLINGS.map((name) => name.length));
  const lines = [
    RULE,
    "THIS CHECKOUT CANNOT REACH A FULL PASS, AND HERE IS WHY. READ THIS FIRST,",
    "BEFORE THE FAILURES BELOW IT.",
    "",
    `${SEAM_TEST_FILE} compares this repository's sibling packages against each`,
    "other. It is the only suite here that looks BETWEEN packages, which is where",
    "the last four escaped defects lived, so an absent sibling FAILS rather than",
    "skips: a seam test that quietly passed because it could not find the thing it",
    "was comparing would reinstate exactly the blind spot it was written to close.",
    ""
  ];
  for (const entry of layout.missing) {
    lines.push(`  MISSING  ${entry.name.padEnd(width)}  looked in:`);
    for (const candidate of entry.looked) lines.push(`             ${candidate}`);
  }
  for (const entry of layout.found) {
    const revision = entry.revision ? `  (${entry.revision})` : "";

    lines.push(`  found    ${entry.name.padEnd(width)}  ${entry.root}${revision}`);
  }
  lines.push(
    "",
    `${seamTestCount === null ? "The" : `All ${seamTestCount}`} seam tests in ` +
      `${SEAM_TEST_FILE} will fail for this reason and no other.`,
    "Nothing else in the suite depends on a sibling, so the run continues and the",
    "rest of the results are good.",
    "",
    "The layout the suite requires:",
    "",
    "  <workspace>/",
    "    visp-dev/            <- this repository",
    // Drawn from REQUIRED_SIBLINGS rather than typed out: a picture that named
    // fewer directories than the check requires is how a reader sets up the
    // layout exactly as told and still fails.
    ...REQUIRED_SIBLINGS.map((name) => `    ${name}/`),
    "",
    "Clone the siblings next to this repository, or vendor them under",
    `${path.join("visp-dev", "engines")}/, and run again.`,
    'README.md, "Workspace layout the suite requires", states this layout too.',
    RULE
  );
  return lines.join("\n");
}

/**
 * Both sides through the filesystem's own answer, not through string equality.
 *
 * Node realpaths the entry module before deriving `import.meta.url`, but
 * `process.argv[1]` is the path the caller typed. Reach this script through a
 * symlink and the two disagree, `invokedDirectly` is false, and the script
 * exits zero having printed NOTHING — the one message written to be read before
 * anything else, silently absent, with no signal that it was skipped.
 *
 * That is not hypothetical. macOS puts `$TMPDIR` under `/var`, which is a
 * symlink to `/private/var`, so every macOS leg of the test matrix hit it the
 * first time the workflow was able to reach this check.
 *
 * `realpathSync` throws on a path that does not exist; falling back to
 * `path.resolve` keeps the old answer rather than crashing an import.
 */
function canonicalPath(value) {
  try {
    return realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  canonicalPath(process.argv[1]) === canonicalPath(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const devRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const layout = workspaceLayout(devRoot);
  process.stdout.write(
    `${layoutBanner(layout, { seamTestCount: countSeamTests(devRoot) })}\n`
  );
}
