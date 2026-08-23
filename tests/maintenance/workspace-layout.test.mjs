/**
 * The preflight that tells a lone clone why it cannot pass.
 *
 * QE cloned this repository on its own and ran the suite. Seven tests failed
 * because `tests/seams.test.mjs` had no siblings to compare, which is a
 * legitimate dependency — but the explanation appeared seven times, in the
 * middle of the output, after the failures it explained. The reader's first
 * hypothesis was that they had broken something.
 *
 * These tests hold the preflight to three things: it detects the absent
 * sibling, it says where it looked, and it does not stop the run. The last one
 * matters as much as the first — a preflight that aborted would hide the
 * hundreds of tests a lone clone passes.
 *
 * EVERY TEST IN THIS FILE MUST PASS IN A LONE CLONE. That is a hard constraint,
 * not a nicety. The banner this file tests says "all N seam tests will fail for
 * this reason and no other" — so a test HERE that required the siblings to be
 * present would fail in a lone clone and make that sentence a lie, in the one
 * message in the whole run that was written to be believed. An earlier draft of
 * this file did exactly that: it asserted `satisfied === true` against the live
 * checkout, and a lone clone produced nine failures under a banner promising
 * seven. So nothing below asserts that this checkout HAS siblings; the
 * assertions are that the preflight tells the truth about whichever checkout it
 * is in, and the absent-sibling behaviour is exercised against temp fixtures.
 */
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  REQUIRED_SIBLINGS,
  SEAM_TEST_FILE,
  candidatePathsFor,
  countSeamTests,
  layoutBanner,
  locateProduct,
  manifestFileFor,
  revisionOf,
  workspaceLayout
} from "../../scripts/maintenance/workspace-layout.mjs";

const execFile = promisify(execFileCallback);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A bare visp-dev with no siblings anywhere — QE's clone, in a temp dir. */
async function loneClone() {
  const workspace = await mkdtemp(path.join(tmpdir(), "visp-dev-lone-"));
  const devRoot = path.join(workspace, "visp-dev");
  await mkdir(devRoot, { recursive: true });
  await writeFile(path.join(devRoot, "package.json"), JSON.stringify({ name: "visp-dev" }));
  return { workspace, devRoot };
}

test("the preflight's verdict on this checkout matches what the seam tests will find", () => {
  // NOT "the siblings are present". Whether they are is a fact about the
  // machine, and asserting it here would break a lone clone (see the note at
  // the top). What must hold in EITHER layout is that the banner printed at the
  // top of the run and the seam failures at the bottom describe the same
  // checkout — they share `locateProduct`, and this is what says so.
  const layout = workspaceLayout(repositoryRoot);

  assert.deepEqual(
    [...layout.found.map((entry) => entry.name), ...layout.missing.map((entry) => entry.name)].sort(),
    [...REQUIRED_SIBLINGS].sort(),
    "every required sibling is accounted for exactly once, as found or as missing"
  );
  for (const entry of layout.found) {
    assert.equal(locateProduct(entry.name, repositoryRoot), entry.root);
  }
  for (const entry of layout.missing) {
    assert.equal(locateProduct(entry.name, repositoryRoot), null);
  }
  assert.equal(layout.satisfied, layout.missing.length === 0);
});

test("only the seam tests depend on a sibling, which is what the banner promises", () => {
  // The banner tells a lone clone that the seam tests "will fail for this
  // reason and no other" and that "nothing else in the suite depends on a
  // sibling". That is a claim about the whole suite, and it is the claim that
  // already went wrong once. Resolving a sibling now goes through exactly one
  // module, so the set of test files that import it is the set that can depend
  // on one — and this file is in that set only to test the resolver itself,
  // under the lone-clone constraint above.
  // RECURSIVE. The suite moved into per-domain directories, and a top-level-only
  // scan would have gone on reporting the same two names while a new file three
  // directories down quietly took a sibling dependency the banner never mentions.
  const importers = readdirSync(path.join(repositoryRoot, "tests"), { recursive: true })
    .map((name) => String(name).split(path.sep).join("/"))
    .filter((name) => name.endsWith(".test.mjs"))
    .filter((name) =>
      readFileSync(path.join(repositoryRoot, "tests", name), "utf8").includes(
        "maintenance/workspace-layout.mjs"
      )
    )
    .sort();

  assert.deepEqual(
    importers,
    [
      // Sibling-OPTIONAL, and that is the condition of it being on this list.
      // It drives the currency entrypoint against a real checkout, so it needs
      // the locator — but an absent sibling makes it SKIP, not fail, because
      // the banner promises a lone clone that the seam tests fail "for this
      // reason and no other". Adding a file here that fails without a sibling
      // makes that sentence false.
      "integration/compatibility/currency.test.mjs",
      "maintenance/seams.test.mjs",
      "maintenance/workspace-layout.test.mjs"
    ],
    "a new test file that resolves a sibling must either be sibling-optional or the banner must stop " +
      "claiming the seam tests are the only ones that need one"
  );
});

test("the sibling-optional importer really is optional, so the banner stays true", () => {
  // The list above is a promise, and a comment is not a check. A lone clone
  // must see this file skip rather than fail, so it must reach for `t.skip`
  // on the absent-sibling path rather than throwing the way the seams do.
  const optional = readFileSync(
    path.join(repositoryRoot, "tests", "integration", "compatibility", "currency.test.mjs"),
    "utf8"
  );

  assert.match(optional, /t\.skip\(/u, "an absent sibling must skip this suite, not fail it");
  assert.doesNotMatch(
    withoutComments(optional),
    /throw new Error\([^)]*needs \$\{name\}/u,
    "this file must not adopt the seam tests' fail-rather-than-skip rule"
  );
});

/**
 * Source text with comments removed, so a doc comment DESCRIBING an inline
 * lookup is not mistaken for one.
 */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[^\n]*?\/\/[^\n]*$/gmu, "");
}

/**
 * Every `join(...)`/`resolve(...)` in `source` that builds a path out of this
 * repository — a `..` segment or an `engines` segment. Those two locations are
 * `candidatePathsFor`'s entire job, so in the seam tests they are the
 * signature of a lookup that went around `locateProduct`.
 *
 * Reading the CALL rather than the raw text matters: `productRoot`'s error
 * message contains the words "../" and "engines/" on purpose, and forbidding
 * the characters would forbid saying where the locator looked.
 */
function inlineSiblingLookups(source) {
  const text = withoutComments(source);
  const found = [];
  for (const opening of text.matchAll(/\b(?:path\.)?(?:join|resolve)\s*\(/gu)) {
    let depth = 1;
    let index = opening.index + opening[0].length;
    while (index < text.length && depth > 0) {
      if (text[index] === "(") depth += 1;
      else if (text[index] === ")") depth -= 1;
      index += 1;
    }
    const call = text.slice(opening.index, index);
    if (/\.\.|engines/u.test(call)) found.push(call.replace(/\s+/gu, " "));
  }
  return found;
}

test("every sibling path in the seam tests is resolved by the shared locator", () => {
  // The neighbouring test checks which FILES import the locator. It cannot see
  // a lookup that goes around the locator INSIDE one of those files — and that
  // is precisely what shipped: seams.test.mjs imported `locateProduct`, used it
  // for Kit and Hyper, and resolved llm-memory with its own candidate loop. The
  // preflight cannot see what it is not asked, so it printed "found" and exited
  // zero over a clone that then failed a seam test for a fourth sibling neither
  // it nor the README mentioned. This asserts the thing that actually matters:
  // no sibling path is built here except through the shared locator.
  //
  // Scoped to the seam file deliberately. This file legitimately builds
  // `engines/` paths — it constructs the fixtures that prove the locator finds
  // a vendored sibling.
  const seamSource = readFileSync(path.join(repositoryRoot, SEAM_TEST_FILE), "utf8");

  assert.match(
    seamSource,
    /import \{[^}]*\blocateProduct\b[^}]*\} from "\.\.\/\.\.\/scripts\/maintenance\/workspace-layout\.mjs";/u,
    "the seam tests must resolve siblings through the module the preflight also uses"
  );
  assert.deepEqual(
    inlineSiblingLookups(seamSource),
    [],
    `${SEAM_TEST_FILE} builds a sibling path itself instead of calling locateProduct. The preflight ` +
      "cannot see that lookup, so its banner would promise a full pass this checkout cannot reach. " +
      "Register the sibling in REQUIRED_SIBLINGS and resolve it with productRoot."
  );
  assert.ok(
    !/\bexistsSync\b/u.test(withoutComments(seamSource)),
    `${SEAM_TEST_FILE} must not probe for a sibling's existence itself; that is locateProduct's job, ` +
      "and a private probe is a dependency the preflight cannot report."
  );

  // AND THE GUARD MUST BE ABLE TO SEE THE THING IT FORBIDS. This is the lookup
  // that was actually in the seam file, verbatim; a guard that passed on it
  // would be a check passing for a reason other than the thing it names.
  const reintroduced = `
    const memoryRoot = (() => {
      for (const candidate of [join(devRoot, "..", "llm-memory"), join(devRoot, "engines", "llm-memory")]) {
        if (existsSync(join(candidate, "pyproject.toml"))) return candidate;
      }
      throw new Error("Seam tests require llm-memory (visp-memory) as a sibling checkout.");
    })();
  `;
  assert.deepEqual(inlineSiblingLookups(reintroduced), [
    'join(devRoot, "..", "llm-memory")',
    'join(devRoot, "engines", "llm-memory")'
  ]);
  assert.ok(/\bexistsSync\b/u.test(withoutComments(reintroduced)));

  // And it must not fire on the shapes the seam file legitimately uses: a path
  // under a root the locator already returned, or one inside this repository.
  assert.deepEqual(
    inlineSiblingLookups(
      'join(productRoot(name), "package.json"); join(devRoot, "src/cli/machine-scope.mjs");'
    ),
    []
  );
});

test("a sibling the preflight does not know about cannot be resolved at all", () => {
  // The structural half of the same fix. Even a lookup that politely calls
  // locateProduct would reintroduce the hole if it named a sibling absent from
  // REQUIRED_SIBLINGS, because the banner iterates that list. So an
  // unregistered name is refused rather than resolved, and the error says where
  // to register it.
  assert.throws(
    () => locateProduct("visp-intel", repositoryRoot),
    /No sibling product is registered under "visp-intel"[\s\S]*REQUIRED_SIBLINGS[\s\S]*README\.md/u
  );
  for (const name of REQUIRED_SIBLINGS) {
    assert.ok(manifestFileFor(name), `${name} must declare the manifest that proves it`);
  }
});

test("a clone with no siblings is reported as unsatisfied, naming both places it looked", async () => {
  const { workspace, devRoot } = await loneClone();
  try {
    const layout = workspaceLayout(devRoot);
    assert.equal(layout.satisfied, false);
    assert.deepEqual(
      layout.missing.map((entry) => entry.name),
      [...REQUIRED_SIBLINGS]
    );
    for (const entry of layout.missing) {
      assert.deepEqual(entry.looked, candidatePathsFor(entry.name, devRoot));
      assert.equal(entry.looked.length, 2, "a sibling checkout and a vendored engines/ copy");
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("a sibling vendored under engines/ satisfies the preflight", async () => {
  const { workspace, devRoot } = await loneClone();
  try {
    for (const name of REQUIRED_SIBLINGS) {
      const vendored = path.join(devRoot, "engines", name);
      await mkdir(vendored, { recursive: true });
      // Each product's own manifest, not package.json for all of them:
      // llm-memory is Python and proves itself with a pyproject.toml.
      await writeFile(path.join(vendored, manifestFileFor(name)), "");
    }
    assert.equal(workspaceLayout(devRoot).satisfied, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("the banner states the layout, the cause, and the count it can prove", async () => {
  const { workspace, devRoot } = await loneClone();
  try {
    const banner = layoutBanner(workspaceLayout(devRoot), { seamTestCount: 7 });

    // The cause, before anything else.
    assert.match(banner.split("\n")[1], /CANNOT REACH A FULL PASS/u);
    assert.match(banner, /READ THIS FIRST/u);
    assert.match(banner, new RegExp(SEAM_TEST_FILE.replace(/[.]/gu, "\\."), "u"));
    // Where it looked, so the reader can act on it.
    for (const name of REQUIRED_SIBLINGS) {
      assert.match(banner, new RegExp(`MISSING\\s+${name}`, "u"));
      for (const candidate of candidatePathsFor(name, devRoot)) {
        assert.ok(banner.includes(candidate), `the banner must name ${candidate}`);
      }
    }
    // The layout itself, drawn, not described — and drawn with every sibling
    // the check requires. A picture missing one is a reader following the
    // instructions exactly and still failing, which is what happened with
    // llm-memory.
    assert.match(banner, /<workspace>\/\n\s+visp-dev\/\s+<- this repository\n/u);
    assert.match(
      banner,
      new RegExp(
        `<workspace>/\\n\\s+visp-dev/\\s+<- this repository\\n${REQUIRED_SIBLINGS.map(
          (name) => `\\s+${name}/`
        ).join("\\n")}\\n`,
        "u"
      ),
      "the drawn layout must name every required sibling, in order"
    );
    // And the promise that the rest of the run is still worth reading.
    assert.match(banner, /All 7 seam tests/u);
    assert.match(banner, /the run continues/u);
    assert.match(banner, /README\.md/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("the predicted failure count is read from the seam file, not written down", async () => {
  // The number in the banner must be the number of tests that actually depend
  // on a sibling. A hardcoded one would be wrong the first time somebody added
  // a seam, and a confident wrong number in the one message written to be
  // believed is worse than no number.
  const counted = countSeamTests(repositoryRoot);
  const seamSource = await readFile(path.join(repositoryRoot, SEAM_TEST_FILE), "utf8");
  const declared = (seamSource.match(/^test\("SEAM:/gmu) ?? []).length;
  assert.equal(counted, declared);
  assert.ok(counted > 0, "the seam suite must still exist for this prediction to mean anything");

  // Tests that live in that file without needing a sibling must not be counted
  // among the ones the banner predicts will fail.
  const everyTest = (seamSource.match(/^test\(/gmu) ?? []).length;
  assert.ok(counted <= everyTest);

  // Unreadable tree: no number rather than a wrong one.
  assert.equal(countSeamTests(path.join(repositoryRoot, "does-not-exist")), null);
  assert.match(
    layoutBanner(workspaceLayout(path.join(repositoryRoot, "does-not-exist", "visp-dev")), {
      seamTestCount: null
    }),
    /The seam tests in/u
  );
});

test("the banner still prints when the checkout is reached through a symlink", async () => {
  // Node realpaths the entry module before deriving `import.meta.url`, but
  // `process.argv[1]` is the path the caller typed. The script decided whether
  // it had been invoked directly by comparing those two as strings, so reaching
  // it through a symlink made them disagree: it exited zero having printed
  // NOTHING. The one message written to be read before anything else, silently
  // absent, with no signal it had been skipped — and "exits zero" would still
  // have been true, so the neighbouring test could not see it.
  //
  // macOS puts $TMPDIR under /var, which is a symlink to /private/var, so every
  // macOS leg of the test matrix hit this the first run that reached the check.
  // The symlink here is explicit rather than inherited from the temp directory,
  // because on Linux it would not be.
  const { workspace, devRoot } = await loneClone();
  try {
    await plantPreflight(devRoot);

    const linked = path.join(workspace, "reached-through-a-symlink");
    // "junction" so this runs on Windows too, where a directory symlink needs
    // privileges a runner does not have. POSIX ignores the type.
    await symlink(devRoot, linked, "junction");

    const { stdout } = await execFile(
      process.execPath,
      [path.join(linked, "scripts", "maintenance", "workspace-layout.mjs")],
      { cwd: linked }
    );

    assert.match(
      stdout,
      /CANNOT REACH A FULL PASS/u,
      "the preflight printed nothing when reached through a symlink"
    );
    for (const name of REQUIRED_SIBLINGS) {
      assert.match(stdout, new RegExp(`MISSING\\s+${name}`, "u"));
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("the README states the layout the suite requires", async () => {
  // The banner tells you once you have already run the suite. The README has to
  // tell you before you clone, and it has to name the same directories — a
  // README describing a layout the preflight does not check is how the two
  // drift apart.
  const readme = await readFile(path.join(repositoryRoot, "README.md"), "utf8");
  assert.ok(
    readme.includes("## Workspace layout the suite requires"),
    "README must have a section stating the layout"
  );
  for (const name of REQUIRED_SIBLINGS) {
    assert.ok(readme.includes(`${name}/`), `README must name ${name} in the layout`);
    assert.ok(
      readme.includes(`visp-dev/engines/${name}`),
      `README must name the vendored ${name} path the preflight also accepts`
    );
  }
  assert.match(readme, new RegExp(SEAM_TEST_FILE.replace(/[.]/gu, "\\."), "u"));
  // The two facts a reader needs and would otherwise guess wrong: the failure
  // is expected in a lone clone, and it does not invalidate the rest of the run.
  assert.match(readme, /cannot reach a full pass/iu);
  assert.match(readme, /fail rather than skip/iu);
  assert.match(readme, /does not stop the run/iu);
});

test("the preflight prints and exits zero, so the rest of the suite still runs", async () => {
  // Exit zero is the contract, not an oversight: aborting would hide the
  // hundreds of tests a lone clone passes. `execFile` rejects on a non-zero
  // exit, so getting past this call IS the exit-zero assertion.
  const { stdout } = await execFile(
    process.execPath,
    [path.join(repositoryRoot, "scripts", "maintenance", "workspace-layout.mjs")],
    { cwd: repositoryRoot }
  );

  // Both banners are correct somewhere, so this pins that the script printed
  // the one matching THIS checkout, rather than pinning the checkout.
  assert.equal(
    stdout,
    `${layoutBanner(workspaceLayout(repositoryRoot), {
      seamTestCount: countSeamTests(repositoryRoot)
    })}\n`
  );
});

/**
 * Copy the preflight and the seam file into a fixture clone, and return the
 * path the script would be invoked by. The seam file goes too: the banner
 * counts its predicted failures from that file rather than from a literal.
 */
async function plantPreflight(devRoot) {
  await mkdir(path.join(devRoot, "scripts", "maintenance"), { recursive: true });
  await mkdir(path.join(devRoot, path.dirname(SEAM_TEST_FILE)), { recursive: true });
  for (const relative of ["scripts/maintenance/workspace-layout.mjs", SEAM_TEST_FILE]) {
    await writeFile(
      path.join(devRoot, relative),
      await readFile(path.join(repositoryRoot, relative), "utf8")
    );
  }
  return path.join(devRoot, "scripts", "maintenance", "workspace-layout.mjs");
}

test("in a lone clone the real script prints the loud banner and still exits zero", async () => {
  // QE's checkout, end to end, as a process. The banner text is covered above
  // at the function level; what this adds is that the SCRIPT reaches it — the
  // unsatisfied path had never been executed, only called.
  const { workspace, devRoot } = await loneClone();
  try {
    const script = await plantPreflight(devRoot);

    const { stdout } = await execFile(process.execPath, [script], { cwd: devRoot });

    assert.match(stdout, /CANNOT REACH A FULL PASS/u);
    assert.match(stdout, /READ THIS FIRST/u);
    for (const name of REQUIRED_SIBLINGS) {
      assert.match(stdout, new RegExp(`MISSING\\s+${name}`, "u"));
    }
    // Counted from the seam file that was copied in, so the number a lone clone
    // is given is the number of seam tests it actually has.
    assert.match(stdout, new RegExp(`All ${countSeamTests(repositoryRoot)} seam tests`, "u"));
    assert.match(stdout, /the run continues/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// LC-76 — the banner names the revision each sibling was compared against, so
// a red matrix can be traced to the repository whose commit caused it.
// ---------------------------------------------------------------------------

test("a sibling with no history of its own reports no revision, not the enclosing repository's", async () => {
  // `git -C` walks UP the tree, so a vendored engines/<name> carrying no .git
  // of its own answers with the ENCLOSING repository's HEAD — and the banner
  // then blames a sibling for that repository's own commit, with more
  // confidence than saying nothing would have carried.
  //
  // BUILT IN A TEMP DIRECTORY, NOT IN THIS CHECKOUT. An earlier version of this
  // test planted `engines/visp-kit` in the real tree and removed it in a
  // `finally`. Both halves were wrong, and CI proved it: the `test` job vendors
  // REAL actions/checkout clones into engines/ (test.yml), so the planted
  // directory already had a .git and `revisionOf` rightly returned its HEAD —
  // twelve red legs, on a branch whose whole purpose is removing a red check.
  // Worse, the cleanup deleted all three vendored siblings, and `run check`
  // runs twice per leg, so the second run would have found no siblings and the
  // seam tests would have failed BY DESIGN. A fixture must never reach outside
  // its own temp directory.
  const workspace = await mkdtemp(path.join(tmpdir(), "visp-dev-vendored-"));

  try {
    await execFile("git", ["-C", workspace, "init", "--quiet"]);
    await execFile("git", ["-C", workspace, "config", "user.name", "Visp Test"]);
    await execFile("git", ["-C", workspace, "config", "user.email", "visp-test@example.invalid"]);
    await writeFile(path.join(workspace, "package.json"), "{}");
    await execFile("git", ["-C", workspace, "add", "package.json"]);
    await execFile("git", ["-C", workspace, "commit", "--quiet", "-m", "enclosing repository"]);

    const vendored = path.join(workspace, "engines", "visp-kit");
    await mkdir(vendored, { recursive: true });
    await writeFile(path.join(vendored, "package.json"), "{}");

    const { stdout: enclosing } = await execFile("git", ["-C", workspace, "rev-parse", "--short", "HEAD"]);
    const { stdout: walkedUp } = await execFile("git", ["-C", vendored, "rev-parse", "--short", "HEAD"]);

    // The bug, demonstrated rather than described: raw git answers about the
    // enclosing repository from inside a directory that is not one. Without
    // this the test could pass for the wrong reason — a `revisionOf` that
    // always returned null would satisfy the assertion below on its own.
    assert.equal(
      walkedUp.trim(),
      enclosing.trim(),
      "the walk-up this guard exists to block did not happen, so the guard is untested here"
    );
    assert.equal(
      revisionOf(vendored),
      null,
      "a directory inside another repository is not a sibling checkout with its own revision"
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("a real sibling checkout reports its own short commit", async () => {
  // The converse, against a repository the test builds, so it holds in a lone
  // clone: every test in this file must pass without siblings present.
  //
  // THIS TEST CAUGHT A WINDOWS-ONLY DEFECT AND IS WORTH KEEPING FOR IT. The
  // first `revisionOf` confirmed a directory owned its repository by comparing
  // `rev-parse --show-toplevel` against the path it was given. On Windows
  // `os.tmpdir()` hands back an 8.3 short name that `realpathSync` does not
  // expand, while git answers with the long form and forward slashes, so the
  // two never matched and a genuine checkout reported NO revision — the same
  // failure from the opposite side. It passed on Linux and macOS and failed all
  // four Windows legs, which is exactly what that leg of the matrix is for.
  //
  // There is no Linux reproduction: every path form realpath CAN canonicalise
  // still matched. The trailing-separator case below is cheap breadth against
  // the bug class, not a substitute for the Windows leg.
  const workspace = await mkdtemp(path.join(tmpdir(), "visp-dev-sibling-"));

  try {
    await execFile("git", ["-C", workspace, "init", "--quiet"]);
    await execFile("git", ["-C", workspace, "config", "user.name", "Visp Test"]);
    await execFile("git", ["-C", workspace, "config", "user.email", "visp-test@example.invalid"]);
    await writeFile(path.join(workspace, "package.json"), "{}");
    await execFile("git", ["-C", workspace, "add", "package.json"]);
    await execFile("git", ["-C", workspace, "commit", "--quiet", "-m", "sibling"]);

    const { stdout } = await execFile("git", ["-C", workspace, "rev-parse", "--short", "HEAD"]);

    assert.equal(revisionOf(workspace), stdout.trim());
    // The answer must not depend on the SHAPE of the path it was handed.
    assert.equal(revisionOf(workspace + path.sep), stdout.trim(), "a trailing separator changed the answer");
    assert.equal(revisionOf(path.join(workspace, ".")), stdout.trim(), "a non-normalised path changed the answer");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("the satisfied banner claims revisions only when it has printed some", async () => {
  const withRevisions = layoutBanner({
    satisfied: true,
    found: [
      { name: "visp-kit", root: "/w/visp-kit", revision: "1a2b3c4" },
      { name: "visp-hyper-agent", root: "/w/visp-hyper-agent", revision: null }
    ],
    missing: []
  });

  assert.match(withRevisions, /visp-kit@1a2b3c4/u);
  assert.match(withRevisions, /visp-hyper-agent(?!@)/u, "a sibling with no history is named bare");
  assert.match(withRevisions, /may be a sibling's commit rather than this repository's/u);

  // A tarball-vendored workspace has no revisions to name, and a banner that
  // pointed at "the revisions named above" while naming none is a sentence a
  // reader stops believing the second time they check it.
  const withoutRevisions = layoutBanner({
    satisfied: true,
    found: [{ name: "visp-kit", root: "/w/visp-kit", revision: null }],
    missing: []
  });

  assert.doesNotMatch(withoutRevisions, /revisions named above/u);
});
