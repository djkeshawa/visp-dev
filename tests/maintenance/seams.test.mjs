// P13-US-04 — the seams between products.
//
// Phase 12 found four defects that survived 3,593 passing tests. Every one of
// them lived BETWEEN packages, where no suite looked: each repo asserted the
// literal it emitted, and nothing ever compared one package's claim against
// another's expectation.
//
// These tests own that comparison. visp-dev is the right home: it is the
// compatibility product, and it already sits above both engines.
//
// THE DISCIPLINE THAT MAKES THESE REAL: extraction failure must FAIL, never
// skip. A seam test that quietly passes because it could not find the constant
// it was checking is the exact failure this project keeps producing — a check
// that passes for a reason other than the thing it names. Every `extract`
// below throws when its pattern misses.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { locateProduct } from "../../scripts/maintenance/workspace-layout.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const devRoot = dirname(dirname(here));

/**
 * Sibling products live at ../<name> in a workspace checkout and at
 * engines/<name> in CI. Absence is a hard failure rather than a skip: these
 * tests exist precisely because nobody was comparing the packages, so silently
 * not comparing them would reinstate the bug.
 *
 * The search itself lives in `scripts/maintenance/workspace-layout.mjs`, which
 * `pretest` runs. ONE definition, because the point of the preflight is that
 * the banner at the top of the run and the failure down here are talking about
 * the same directories — a preflight that said "found" while this said
 * "missing" would be worse than no preflight.
 *
 * THAT IS NOT A STYLE RULE, AND IT HAS ALREADY BEEN BROKEN ONCE. SEAM 4 below
 * resolved llm-memory with its own inline candidate loop; the preflight could
 * not see a lookup that went around it, so it printed "found" and exited zero
 * over a clone that was about to fail for a sibling neither it nor the README
 * had named. Every sibling path in this file goes through `productRoot`, and
 * `tests/workspace-layout.test.mjs` fails the build if one does not.
 */
function productRoot(name) {
  const root = locateProduct(name, devRoot);
  if (root !== null) return root;
  throw new Error(
    `Seam tests require ${name}. Looked in ../${name} and engines/${name}. ` +
      "These tests compare packages against each other; without the sibling there is nothing to " +
      'compare. See "Workspace layout the suite requires" in README.md; `pnpm test` prints this ' +
      "at the top of the run."
  );
}

function manifest(name) {
  return JSON.parse(readFileSync(join(productRoot(name), "package.json"), "utf8"));
}

function source(name, relativePath) {
  return readFileSync(join(productRoot(name), relativePath), "utf8");
}

/** Pull a value out of source text, failing loudly when the shape moved. */
function extract(pattern, text, what) {
  const match = pattern.exec(text);
  if (match === null) {
    throw new Error(
      `Could not extract ${what}. The source shape changed, so this seam is no longer being checked — ` +
        "fix the extraction rather than deleting the test."
    );
  }
  return match;
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(String(value));
  if (match === null) throw new Error(`Not a semantic version: ${value}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

// ---------------------------------------------------------------------------
// SEAM 1 — Kit's declared CLI name vs the command it actually installs.
// Phase 12 defect: the contract reported cliName "visp" while the package
// installed "visp-kit", telling every consumer to spawn the coordinator while
// believing it was invoking the engine. Kit's own tests asserted the literal it
// emitted; Hyper's accepted both. Only this comparison exposes it.
// ---------------------------------------------------------------------------

test("SEAM: Kit's contract names the command Kit actually installs", () => {
  const kit = manifest("visp-kit");
  const declared = Object.keys(kit.bin ?? {});
  assert.equal(declared.length, 1, "visp-kit must declare exactly one command");

  const contractSource = source("visp-kit", "src/workflows/integration.workflow.ts");

  // EVERY occurrence must agree with the installed command, not just the first.
  //
  // The first draft of this test matched only the first `cliName: "..."`, which
  // in this file is the TYPE declaration — so reintroducing the historical bug
  // in the emitted VALUE left the test green. It was a check passing for a
  // reason other than the thing it named: precisely the defect class this suite
  // exists to catch, reproduced inside the suite itself. Verified by putting
  // the bug back and watching this fail.
  const occurrences = [...contractSource.matchAll(/cliName:\s*"([^"]+)"/gu)].map(([, v]) => v);
  assert.ok(
    occurrences.length >= 2,
    `Expected the contract's cliName to appear as both a type and a value; found ${occurrences.length}. ` +
      "The extraction is out of date, so this seam is no longer being checked."
  );

  for (const cliName of occurrences) {
    assert.equal(
      cliName,
      declared[0],
      `Kit's contract mentions cliName "${cliName}" but the package installs "${declared[0]}". ` +
        "A consumer trusting the contract would spawn a command this package does not provide."
    );
  }
});

// ---------------------------------------------------------------------------
// SEAM 2 — the version range between Kit and Hyper, which must not exist.
//
// This seam used to compare Hyper's `peerDependencies: { "visp-kit": ... }`
// against Kit's version: Phase 12 shipped ">=0.2.3 <0.5.0" while Kit moved to
// 0.5.0, and nothing in either repository compared the two.
//
// visp-kit ADR 0007 (Accepted, 2026-08-15) then retired the range itself rather
// than correcting its bounds. The dependency was `optional: true`, so npm never
// enforced it; Hyper spawns the `visp-kit` binary instead of importing it; the
// compatibility matrix pins commit, tree and tarball hash and deliberately
// records NO version strings to range over; and the range's own floor,
// visp-kit@0.2.3, is the one build `registryState.hazard` forbids, because it
// still declares the `visp` binary Hyper owns. A narrower range would have been
// the same unmeasured claim with better bounds. visp-hyper-agent deleted both
// blocks in 7c0d300.
//
// So the old assertion had become one that could only fail: it demanded a
// contract the products deliberately no longer have. The seam is still real,
// but it inverted. What must be compared across the repositories now is that
// NEITHER publishes a semver range for the other — ADR 0007 asks explicitly
// that the absence read as a decision rather than as an omission a future
// maintainer helpfully fills in, and a reinstated range is exactly the drift
// this catches. The ADR's own status is read here too: if Kit ever supersedes
// it, this seam must be re-derived from whatever replaced it rather than
// quietly enforcing a retired rule.
// ---------------------------------------------------------------------------

/** Every dependency field of `pkg` that names `dependency`, with its range. */
function declaredRangesFor(pkg, dependency) {
  const fields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  return fields
    .filter((field) => Object.hasOwn(pkg[field] ?? {}, dependency))
    .map((field) => `${field}: "${pkg[field][dependency]}"`);
}

test("SEAM: neither Kit nor Hyper publishes a version range for the other", () => {
  const adr = source("visp-kit", "docs/adr/0007-pair-compatibility-is-pinned-not-ranged.md");
  const status = extract(/^-\s*\*\*Status:\*\*\s*(\S+)/mu, adr, "the status of Kit ADR 0007")[1];
  assert.equal(
    status,
    "Accepted",
    `Kit ADR 0007 is "${status}", not Accepted. The rule this seam enforces has moved, so re-derive ` +
      "the seam from whatever supersedes it rather than deleting the test."
  );

  assert.deepEqual(
    declaredRangesFor(manifest("visp-hyper-agent"), "visp-kit"),
    [],
    "visp-hyper-agent declares a visp-kit version range again. ADR 0007 deleted it rather than " +
      "narrowing it: npm cannot enforce it, Hyper spawns the binary instead of importing it, and " +
      "the matrix records no version strings for a range to mean anything against."
  );
  assert.deepEqual(
    declaredRangesFor(manifest("visp-kit"), "visp-hyper-agent"),
    [],
    "visp-kit declares a visp-hyper-agent version range. Kit publishes no supported semver range " +
      "for Hyper (ADR 0007 rule 1); compatibility is the pinned pair in visp-dev's matrix."
  );
});

test("SEAM: Hyper's refusals send the reader to the pinned pair, not to a version bump", () => {
  // The runtime check ADR 0007 put in the deleted range's place. Asserting the
  // absence alone would be half the contract: a reader who hits a negotiation
  // refusal used to go looking for a Kit version that satisfied the peer range,
  // and there is none to find. Every refusal now has to say so and name a
  // command that answers the question instead.
  const guidance = extract(
    /PINNED_PAIR_GUIDANCE\s*=\s*([\s\S]*?);\n/u,
    source("visp-hyper-agent", "src/kit/workflow-action-protocol.ts"),
    "Hyper's pinned-pair guidance"
  )[1];

  assert.match(
    guidance,
    /pinned by commit and artifact hash/u,
    "Hyper's negotiation refusals must state the pinned-pair model that replaced the peer range."
  );

  // And the command it sends the reader to has to be one visp-dev provides.
  // Hyper naming a visp-dev command that does not exist is the same seam defect
  // in the other direction, and only this repository can see both halves.
  const named = extract(/`visp-dev ([a-z]+)`/u, guidance, "the visp-dev command Hyper points at")[1];
  const devCommands = [
    ...extract(
      /const run = \{([^}]*)\}\[command\]/u,
      readFileSync(join(devRoot, "scripts/visp-dev.mjs"), "utf8"),
      "visp-dev's command table"
    )[1].matchAll(/[a-z]+/gu)
  ].map(([command]) => command);

  assert.ok(
    devCommands.includes(named),
    `Hyper's guidance tells the reader to run \`visp-dev ${named}\`, which visp-dev does not ` +
      `provide; it offers ${JSON.stringify(devCommands)}.`
  );
});

// ---------------------------------------------------------------------------
// SEAM 3 — Hyper's trust anchors vs Kit's schema hashes.
// Not a Phase 12 defect: a latent one. Hyper hardcodes the WorkflowAction
// schema hashes it trusts. If Kit regenerates a schema and Hyper's anchor is
// not updated, negotiation fails at RUNTIME, in a user's project, with a
// hash-mismatch nobody can act on. Nothing compares them today.
// ---------------------------------------------------------------------------

function hashMap(text, constantName) {
  const block = extract(
    new RegExp(`${constantName}\\s*=\\s*Object\\.freeze\\(\\{([\\s\\S]*?)\\}`, "u"),
    text,
    `the ${constantName} table`
  )[1];
  const entries = [...block.matchAll(/"([\d.]+)":\s*"(sha256:[a-f0-9]{64})"/gu)];
  if (entries.length === 0) {
    throw new Error(`${constantName} parsed to zero entries; the extraction is wrong, not the data.`);
  }
  return Object.fromEntries(entries.map(([, version, hash]) => [version, hash]));
}

test("SEAM: Hyper trusts exactly the schema hashes Kit publishes", () => {
  const kitHashes = hashMap(
    source("visp-kit", "src/integration/workflow-action-schema.ts"),
    "WORKFLOW_ACTION_SCHEMA_HASHES"
  );
  const hyperHashes = hashMap(
    source("visp-hyper-agent", "src/kit/workflow-action-protocol.ts"),
    "TRUSTED_WORKFLOW_ACTION_SCHEMA_HASHES"
  );

  for (const [version, hash] of Object.entries(hyperHashes)) {
    assert.ok(
      kitHashes[version],
      `Hyper trusts protocol ${version}, which Kit does not publish a schema hash for.`
    );
    assert.equal(
      hash,
      kitHashes[version],
      `Protocol ${version}: Hyper's trust anchor does not match Kit's published schema hash. ` +
        "Negotiation would fail at runtime in a user's project."
    );
  }
});

test("SEAM: every protocol Hyper prefers is one Kit actually supports", () => {
  const kitSupported = [
    ...extract(
      /SUPPORTED_WORKFLOW_ACTION_PROTOCOLS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]/u,
      source("visp-kit", "src/integration/workflow-action-schema.ts"),
      "Kit's supported protocol list"
    )[1].matchAll(/"([\d.]+)"/gu)
  ].map(([, v]) => v);

  const hyperPreference = [
    ...extract(
      /WORKFLOW_ACTION_PROTOCOL_PREFERENCE\s*=\s*Object\.freeze\(\[([\s\S]*?)\]/u,
      source("visp-hyper-agent", "src/kit/workflow-action-protocol.ts"),
      "Hyper's protocol preference order"
    )[1].matchAll(/"([\d.]+)"/gu)
  ].map(([, v]) => v);

  assert.ok(kitSupported.length > 0 && hyperPreference.length > 0);
  for (const version of hyperPreference) {
    assert.ok(
      kitSupported.includes(version),
      `Hyper prefers protocol ${version}, which Kit does not support. ` +
        "Negotiation would silently fall back rather than use the version Hyper was built for."
    );
  }

  // 3.3 is reserved by Kit ADR 0003 for signature fields and must never be
  // negotiated by either side until that work lands.
  assert.ok(!hyperPreference.includes("3.3"), "3.3 is reserved (Kit ADR 0003)");
  assert.ok(!kitSupported.includes("3.3"), "3.3 is reserved (Kit ADR 0003)");
});

// ---------------------------------------------------------------------------
// SEAM 4 — Hyper's Memory contract version vs Memory's own.
// Hyper speaks a versioned CLI contract to visp-memory. Both sides declare the
// version independently; if they drift, `recall` and `learn` refuse at runtime
// with "upgrade visp-memory", which is unactionable when the real cause is that
// the two constants disagree.
// ---------------------------------------------------------------------------

test("SEAM: Hyper and Memory agree on the contract version they speak", () => {
  const hyperVersion = extract(
    /MEMORY_CONTRACT_VERSION\s*=\s*"([\d.]+)"/u,
    source("visp-hyper-agent", "src/memory/memory-cli-contract.ts"),
    "Hyper's Memory contract version"
  )[1];

  // Through `productRoot` like every other sibling here. This used to be an
  // inline candidate loop, which is how llm-memory became a requirement the
  // preflight never checked and the README never mentioned.
  const memoryVersion = extract(
    /MEMORY_CONTRACT_VERSION\s*=\s*"([\d.]+)"/u,
    source("llm-memory", "src/visp_memory/interfaces/cli.py"),
    "Memory's own contract version"
  )[1];

  assert.equal(
    hyperVersion,
    memoryVersion,
    `Hyper speaks Memory contract ${hyperVersion} while Memory implements ${memoryVersion}. ` +
      "recall and learn would refuse at runtime with an upgrade instruction that cannot fix it."
  );
});

// ---------------------------------------------------------------------------
// SEAM 5 — visp-dev's machine-scope floors vs the packages they gate.
// `visp setup` refuses a pair below its floors. If the floors drift above what
// the workspace actually builds, setup refuses a correct installation; if they
// drift below the versions carrying a required fix, it blesses a broken one.
// ---------------------------------------------------------------------------

test("SEAM: setup's version floors are satisfied by the packages in this workspace", () => {
  const machineScope = readFileSync(join(devRoot, "src/cli/machine-scope.mjs"), "utf8");
  const kitFloor = extract(
    /kit:\s*\{\s*binary:\s*"([^"]+)",\s*floor:\s*\[(\d+),\s*(\d+)\]/u,
    machineScope,
    "setup's Kit floor"
  );
  const hyperFloor = extract(
    /hyper:\s*\{\s*binary:\s*"([^"]+)",\s*floor:\s*\[(\d+),\s*(\d+)\]/u,
    machineScope,
    "setup's Hyper floor"
  );

  const kit = manifest("visp-kit");
  const hyper = manifest("visp-hyper-agent");

  // The floor must name the command the package actually installs.
  assert.ok(
    Object.keys(kit.bin ?? {}).includes(kitFloor[1]),
    `setup looks for "${kitFloor[1]}" but visp-kit installs ${JSON.stringify(Object.keys(kit.bin ?? {}))}.`
  );
  assert.ok(
    Object.keys(hyper.bin ?? {}).includes(hyperFloor[1]),
    `setup looks for "${hyperFloor[1]}" but visp-hyper-agent installs ${JSON.stringify(Object.keys(hyper.bin ?? {}))}.`
  );

  // And the workspace's own versions must clear it, or setup rejects a correct pair.
  const meets = (version, M, m) => {
    const v = parseVersion(version);
    return v.major !== Number(M) ? v.major > Number(M) : v.minor >= Number(m);
  };
  assert.ok(
    meets(kit.version, kitFloor[2], kitFloor[3]),
    `visp-kit@${kit.version} is below setup's own floor ${kitFloor[2]}.${kitFloor[3]}.0.`
  );
  assert.ok(
    meets(hyper.version, hyperFloor[2], hyperFloor[3]),
    `visp-hyper-agent@${hyper.version} is below setup's own floor ${hyperFloor[2]}.${hyperFloor[3]}.0.`
  );
});

// ---------------------------------------------------------------------------
// SEAM 6 — the coordinator's verb surface vs its MCP mirror.
// D-106 promises thirteen verbs mirrored 1:1 as visp_* MCP tools. Hyper tests
// this internally; it is repeated here because the promise is a PRODUCT-level
// claim that visp-dev's compatibility matrix implicitly relies on.
// ---------------------------------------------------------------------------

test("SEAM: the thirteen verbs and their MCP mirror stay 1:1", () => {
  const cli = source("visp-hyper-agent", "src/cli/index.ts");
  const verbs = [
    ...extract(
      /THIRTEEN_VERBS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]/u,
      cli,
      "the thirteen-verb table"
    )[1].matchAll(/"([a-z]+)"/gu)
  ].map(([, v]) => v);

  assert.equal(verbs.length, 13, `expected thirteen verbs, found ${verbs.length}`);

  // Hyper split tool-bridge.ts into tool-bridge/ at 620165e, taking the tool
  // table with it. This read used a bare matchAll, so it did not throw the way
  // extract() does — it returned [] and the seam reported a confusing empty
  // diff instead of saying it had stopped checking. The guard below is what
  // extract() gives every other read in this file.
  const bridge = source("visp-hyper-agent", "src/mcp/tool-bridge/tool-specs.ts");
  const tools = [...bridge.matchAll(/name:\s*"(visp_[a-z]+)"/gu)].map(([, t]) => t);
  if (tools.length === 0) {
    throw new Error(
      "Could not extract the MCP tool table. The source shape changed, so this seam is no longer " +
        "being checked — fix the extraction rather than deleting the test."
    );
  }

  assert.deepEqual(
    tools,
    verbs.map((verb) => `visp_${verb}`),
    "the MCP tool table must mirror the verb table exactly, in order"
  );
});
