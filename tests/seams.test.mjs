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
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const devRoot = join(here, "..");

/**
 * Sibling products live at ../<name> in a workspace checkout and at
 * engines/<name> in CI. Absence is a hard failure rather than a skip: these
 * tests exist precisely because nobody was comparing the packages, so silently
 * not comparing them would reinstate the bug.
 */
function productRoot(name) {
  for (const candidate of [join(devRoot, "..", name), join(devRoot, "engines", name)]) {
    if (existsSync(join(candidate, "package.json"))) return candidate;
  }
  throw new Error(
    `Seam tests require ${name}. Looked in ../${name} and engines/${name}. ` +
      "These tests compare packages against each other; without the sibling there is nothing to compare."
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
// SEAM 2 — Hyper's peer range vs the Kit it is built against.
// Phase 12 defect: Hyper declared ">=0.2.3 <0.5.0" while Kit moved to 0.5.0.
// Nothing in either repo compared the two, so it would have shipped an unmet
// peer dependency to every user installing the pair.
// ---------------------------------------------------------------------------

test("SEAM: Hyper's peer range admits the Kit version in this workspace", () => {
  const hyper = manifest("visp-hyper-agent");
  const kit = manifest("visp-kit");
  const range = hyper.peerDependencies?.["visp-kit"];
  assert.ok(range, "visp-hyper-agent must declare a visp-kit peer dependency");

  const upper = extract(/<\s*(\d+)\.(\d+)\.(\d+)/u, range, "the upper bound of Hyper's peer range");
  const lower = extract(/>=\s*(\d+)\.(\d+)\.(\d+)/u, range, "the lower bound of Hyper's peer range");
  const kitVersion = parseVersion(kit.version);

  const below = (v, M, m) => v.major < Number(M) || (v.major === Number(M) && v.minor < Number(m));
  const atLeast = (v, M, m) =>
    v.major > Number(M) || (v.major === Number(M) && v.minor >= Number(m));

  assert.ok(
    below(kitVersion, upper[1], upper[2]),
    `Hyper's peer range ${range} excludes visp-kit@${kit.version}, the Kit it is built against. ` +
      "Installing the pair would report an unmet peer dependency."
  );
  assert.ok(
    atLeast(kitVersion, lower[1], lower[2]),
    `Hyper's peer range ${range} starts above visp-kit@${kit.version}.`
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

  const memoryRoot = (() => {
    for (const candidate of [join(devRoot, "..", "llm-memory"), join(devRoot, "engines", "llm-memory")]) {
      if (existsSync(join(candidate, "pyproject.toml"))) return candidate;
    }
    throw new Error("Seam tests require llm-memory (visp-memory) as a sibling checkout.");
  })();

  const memoryVersion = extract(
    /MEMORY_CONTRACT_VERSION\s*=\s*"([\d.]+)"/u,
    readFileSync(join(memoryRoot, "src/visp_memory/interfaces/cli.py"), "utf8"),
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
  const machineScope = readFileSync(join(devRoot, "src/machine-scope.mjs"), "utf8");
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

  const bridge = source("visp-hyper-agent", "src/mcp/tool-bridge.ts");
  const tools = [...bridge.matchAll(/name:\s*"(visp_[a-z]+)"/gu)].map(([, t]) => t);

  assert.deepEqual(
    tools,
    verbs.map((verb) => `visp_${verb}`),
    "the MCP tool table must mirror the verb table exactly, in order"
  );
});
