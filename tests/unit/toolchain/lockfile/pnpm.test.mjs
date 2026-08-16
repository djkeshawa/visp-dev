import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  canonicalStringify,
  cleanupOwnedRoot,
  createOwnedRoot,
  packPackageTwice,
  sha256Hex,
} from "../../../../src/toolchain/index.mjs";
import {
  makeAliasScenarioManager,
  makePnpmScenarioManager,
} from "../../../helpers/pnpm-scenario.mjs";
import {
  makeOptionalPreparedToyPackage,
  makePreparedAliasToyPackage,
  makePreparedToyPackage,
} from "../../../helpers/prepared-graph.mjs";
import {
  directoryDigest,
  sourceState,
} from "../../../helpers/toy-package.mjs";

test("pinned pnpm records deterministic optional absences from a real offline toy graph", async (t) => {
  const toy = await makeOptionalPreparedToyPackage(t);

  if (toy === null) return;
  const sourceBefore = await sourceState(toy.root);
  const storeBefore = await directoryDigest(toy.storeSource);
  const owned = await createOwnedRoot();
  t.after(() => cleanupOwnedRoot({ root: owned.root }));

  const packed = await packPackageTwice({
    repositoryRoot: toy.root,
    commit: toy.commit,
    ownedRoot: owned.root,
    offlineStoreSource: toy.storeSource,
    packageManagerCommand: "pnpm",
  });

  const first = packed.preparations.first.dependencyTree;
  const second = packed.preparations.second.dependencyTree;
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.absenceSha256, second.absenceSha256);
  assert.match(first.absenceSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(first.absences, second.absences);
  assert.equal(first.absenceSha256, sha256Hex(canonicalStringify(first.absences)));
  assert.deepEqual(
    first.tree.dependencies.map(({ name, version }) => ({ name, version })),
    [
      { name: "visp-optional-applicable", version: "1.0.0" },
      { name: "visp-optional-toy-builder", version: "1.0.0" },
    ],
  );
  assert.deepEqual(
    first.absences.map(({ name, source, status, version }) => ({ name, source, status, version })),
    toy.skippedNames.map((name) => ({
      name,
      source: "pnpm_skipped",
      status: "optional_absent",
      version: "1.0.0",
    })),
  );
  for (const absence of first.absences) {
    assert.equal(typeof absence.path, "string");
    assert.ok(absence.path.length > 0);
  }
  assert.deepEqual(
    first.absences,
    [...first.absences].sort((left, right) => {
      const leftRecord = canonicalStringify(left);
      const rightRecord = canonicalStringify(right);
      return leftRecord < rightRecord ? -1 : leftRecord > rightRecord ? 1 : 0;
    }),
  );

  const evidence = canonicalStringify(packed.preparations);
  for (const forbiddenPath of [owned.root, toy.root, toy.storeSource]) {
    assert.doesNotMatch(evidence, new RegExp(forbiddenPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  }
  assert.doesNotMatch(evidence, /"(?:prunedAt|storeDir|timestamp)"\s*:/iu);
  assert.doesNotMatch(evidence, /platform[_ -]?(?:incompatible|unsupported)|unsupported[_ -]?platform/iu);
  assert.doesNotMatch(evidence, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u);
  assert.deepEqual(await sourceState(toy.root), sourceBefore);
  assert.equal(await directoryDigest(toy.storeSource), storeBefore);
});

test("pinned pnpm optional classification and modules state fail closed without mutating inputs", async (t) => {
  const requiredToy = await makePreparedToyPackage(t);

  if (requiredToy === null) return;
  const optionalToy = await makePreparedToyPackage(t, { dependencyGroup: "optionalDependencies" });

  if (optionalToy === null) return;
  const cases = [
    {
      name: "required missing identity rejects even when forged as skipped",
      scenario: "required_missing_skipped",
      toy: requiredToy,
    },
    {
      name: "required child below an installed optional parent rejects",
      scenario: "required_child_below_optional",
      toy: optionalToy,
    },
    {
      name: "optional missing identity rejects when not recorded as skipped",
      scenario: "optional_missing_not_skipped",
      toy: optionalToy,
    },
    {
      name: "present identity rejects when recorded as skipped",
      scenario: "present_skipped",
      toy: optionalToy,
    },
    {
      name: "lexically escaping nominal path rejects even when its real target is confined",
      scenario: "escaping_nominal_path",
      toy: requiredToy,
    },
    {
      name: "tree and installed-manifest identity mismatch rejects",
      scenario: "identity_mismatch",
      toy: requiredToy,
    },
    {
      name: "malformed modules state rejects",
      scenario: "malformed_modules",
      toy: requiredToy,
    },
    {
      name: "duplicate skipped identity rejects",
      scenario: "duplicate_skipped",
      toy: requiredToy,
    },
    {
      name: "wrong package manager in modules state rejects",
      scenario: "wrong_manager",
      toy: requiredToy,
    },
    {
      name: "store outside the copied preparation store rejects",
      scenario: "wrong_store",
      toy: requiredToy,
    },
    {
      name: "full and no-optional tree contradiction rejects",
      scenario: "full_no_optional_contradiction",
      toy: optionalToy,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async (subtest) => {
      const sourceBefore = await sourceState(fixture.toy.root);
      const storeBefore = await directoryDigest(fixture.toy.storeSource);
      const manager = await makePnpmScenarioManager(subtest, fixture.scenario);

      if (manager === null) return;
      const owned = await createOwnedRoot();
      subtest.after(() => cleanupOwnedRoot({ root: owned.root }));
      try {
        await assert.rejects(
          () => packPackageTwice({
            repositoryRoot: fixture.toy.root,
            commit: fixture.toy.commit,
            ownedRoot: owned.root,
            offlineStoreSource: fixture.toy.storeSource,
            packageManagerCommand: manager,
          }),
          undefined,
          fixture.name,
        );
      } finally {
        assert.deepEqual(await sourceState(fixture.toy.root), sourceBefore);
        assert.equal(await directoryDigest(fixture.toy.storeSource), storeBefore);
      }
    });
  }
});

test("pinned pnpm accepts closed present aliases and preserves logical tree identity", async (t) => {
  const cases = [
    { name: "exact alias spec", aliasSpec: "npm:strip-ansi@6.0.1" },
    { name: "caret alias spec", aliasSpec: "npm:strip-ansi@^6.0.0" },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async (subtest) => {
      const alias = await makePreparedAliasToyPackage(subtest, { aliasSpec: fixture.aliasSpec });

      if (alias === null) return;
      const sourceBefore = await sourceState(alias.root);
      const storeBefore = await directoryDigest(alias.storeSource);
      const owned = await createOwnedRoot();
      subtest.after(() => cleanupOwnedRoot({ root: owned.root }));

      const packed = await packPackageTwice({
        repositoryRoot: alias.root,
        commit: alias.commit,
        ownedRoot: owned.root,
        offlineStoreSource: alias.storeSource,
        packageManagerCommand: "pnpm",
      });

      const expectedTree = {
        dependencies: [
          {
            dependencies: [],
            name: alias.logicalName,
            version: alias.version,
          },
        ],
        name: "prepared-alias-toy",
        version: "1.0.0",
      };
      assert.deepEqual(packed.preparations.first.dependencyTree.tree, expectedTree);
      assert.deepEqual(packed.preparations.second.dependencyTree.tree, expectedTree);
      assert.equal(
        packed.preparations.first.dependencyTree.sha256,
        sha256Hex(canonicalStringify(expectedTree)),
      );
      assert.equal(
        packed.preparations.second.dependencyTree.sha256,
        sha256Hex(canonicalStringify(expectedTree)),
      );
      assert.deepEqual(await sourceState(alias.root), sourceBefore);
      assert.equal(await directoryDigest(alias.storeSource), storeBefore);
    });
  }
});

test("pinned pnpm aliases fail closed on edge, target, manifest, spec, and version contradictions", async (t) => {
  const alias = await makePreparedAliasToyPackage(t);

  if (alias === null) return;
  const cases = [
    { name: "undeclared logical alias rejects", scenario: "undeclared_alias" },
    { name: "raw pnpm alias target mismatch rejects", scenario: "target_mismatch" },
    { name: "installed alias manifest mismatch rejects", scenario: "manifest_mismatch" },
    { name: "unsupported alias range syntax rejects", scenario: "unsupported_alias_spec" },
    { name: "malformed alias spec rejects", scenario: "malformed_alias_spec" },
    { name: "resolved alias version outside authored range rejects", scenario: "out_of_range_alias" },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async (subtest) => {
      const sourceBefore = await sourceState(alias.root);
      const storeBefore = await directoryDigest(alias.storeSource);
      const manager = await makeAliasScenarioManager(subtest, fixture.scenario, alias);

      if (manager === null) return;
      const owned = await createOwnedRoot();
      subtest.after(() => cleanupOwnedRoot({ root: owned.root }));
      try {
        await assert.rejects(
          () => packPackageTwice({
            repositoryRoot: alias.root,
            commit: alias.commit,
            ownedRoot: owned.root,
            offlineStoreSource: alias.storeSource,
            packageManagerCommand: manager,
          }),
          undefined,
          fixture.name,
        );
      } finally {
        assert.deepEqual(await sourceState(alias.root), sourceBefore);
        assert.equal(await directoryDigest(alias.storeSource), storeBefore);
      }
    });
  }
});

test("pinned pnpm accepts representative ordinary specs and present peer edges", async (t) => {
  const toy = await makePreparedToyPackage(t);

  if (toy === null) return;
  const cases = [
    { name: "tilde", scenario: "ordinary_spec:~1.0.0" },
    { name: "union", scenario: "ordinary_spec:^1.0.0 || ^2.0.0" },
    { name: "wildcard", scenario: "ordinary_spec:*" },
    { name: "comparator range", scenario: "ordinary_spec:>=1 <2" },
    { name: "present peer edge", scenario: "present_peer_edge" },
    { name: "present optional peer edge omitted by no-optional view", scenario: "optional_peer_edge" },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async (subtest) => {
      const manager = await makePnpmScenarioManager(subtest, fixture.scenario);

      if (manager === null) return;
      const owned = await createOwnedRoot();
      subtest.after(() => cleanupOwnedRoot({ root: owned.root }));
      const packed = await packPackageTwice({
        repositoryRoot: toy.root,
        commit: toy.commit,
        ownedRoot: owned.root,
        offlineStoreSource: toy.storeSource,
        packageManagerCommand: manager,
      });
      assert.deepEqual(
        packed.preparations.first.dependencyTree.tree.dependencies.map(({ name, version }) => ({ name, version })),
        [{ name: "visp-toy-builder-offline", version: "1.0.0" }],
      );
    });
  }
});

test("pinned pnpm ordinary and peer edges reject undeclared, ambiguous, or mismatched identity", async (t) => {
  const toy = await makePreparedToyPackage(t);

  if (toy === null) return;
  const cases = [
    { name: "undeclared edge", scenario: "undeclared_edge" },
    { name: "ambiguous peer edge", scenario: "ambiguous_peer_edge" },
    { name: "peer target mismatch", scenario: "peer_identity_mismatch" },
    { name: "malformed optional peer metadata", scenario: "malformed_optional_peer_meta" },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async (subtest) => {
      const manager = await makePnpmScenarioManager(subtest, fixture.scenario);

      if (manager === null) return;
      const owned = await createOwnedRoot();
      subtest.after(() => cleanupOwnedRoot({ root: owned.root }));
      await assert.rejects(() => packPackageTwice({
        repositoryRoot: toy.root,
        commit: toy.commit,
        ownedRoot: owned.root,
        offlineStoreSource: toy.storeSource,
        packageManagerCommand: manager,
      }));
    });
  }
});
