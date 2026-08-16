import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";

import {
  assertMatchingPacks,
  canonicalStringify,
  cleanupOwnedRoot,
  createOwnedRoot,
  packPackageTwice,
  runCompatibilityLab,
} from "../../../src/toolchain/index.mjs";
import {
  makePreparedToyPackage,
} from "../../helpers/prepared-graph.mjs";
import {
  directoryDigest,
  git,
  makeToyPackage,
  sourceState,
} from "../../helpers/toy-package.mjs";

test("pack preparation is pinned, offline, ambient-config resistant, and repeated independently", async (t) => {
  const toy = await makePreparedToyPackage(t);

  if (toy === null) return;
  const callerStoreBefore = await directoryDigest(toy.storeSource);
  assert.ok((await readdir(toy.storeSource)).length > 0);
  const emptyStore = await mkdtemp(path.join(tmpdir(), "visp empty pnpm store "));
  t.after(() => rm(emptyStore, { recursive: true, force: true }));
  const emptyStoreRoot = await createOwnedRoot();
  t.after(() => cleanupOwnedRoot({ root: emptyStoreRoot.root }));
  await assert.rejects(
    packPackageTwice({
      repositoryRoot: toy.root,
      commit: toy.commit,
      ownedRoot: emptyStoreRoot.root,
      offlineStoreSource: emptyStore,
      packageManagerCommand: "pnpm",
    }),
    /offline lockfile preparation failed/i,
  );
  const owned = await createOwnedRoot();
  t.after(() => cleanupOwnedRoot({ root: owned.root }));
  const previousIgnoreScripts = process.env.npm_config_ignore_scripts;
  const previousToken = process.env.NPM_TOKEN;
  process.env.npm_config_ignore_scripts = "true";
  process.env.NPM_TOKEN = "must-not-reach-lifecycle";
  try {
    const packed = await packPackageTwice({
      repositoryRoot: toy.root,
      commit: toy.commit,
      ownedRoot: owned.root,
      offlineStoreSource: toy.storeSource,
      packageManagerCommand: "pnpm",
    });
    assert.ok(packed.first.members.includes("package/generated-by-dev-dependency.txt"));
    assert.equal(packed.first.tool.lifecycleScriptsPolicy, "required");
    assert.equal(packed.preparations.first.tool.pinned, "pnpm@11.3.0");
    assert.equal(packed.preparations.first.offline, true);
    assert.equal(packed.preparations.first.lifecycleScriptsDisabled, true);
    assert.equal(packed.preparations.first.lockfile.path, "pnpm-lock.yaml");
    assert.match(packed.preparations.first.lockfile.sha256, /^[0-9a-f]{64}$/);
    assert.equal(packed.preparations.first.store.mode, "caller_snapshot");
    assert.match(packed.preparations.first.store.sourceInventorySha256, /^[0-9a-f]{64}$/);
    assert.equal(
      packed.preparations.first.dependencyTree.sha256,
      packed.preparations.second.dependencyTree.sha256,
    );
    assert.deepEqual(
      packed.preparations.first.dependencyTree.tree.dependencies.map(({ name, version }) => ({ name, version })),
      [{ name: "visp-toy-builder-offline", version: "1.0.0" }],
    );
    const preparationEvidence = canonicalStringify(packed.preparations);
    assert.doesNotMatch(preparationEvidence, /must-not-reach-lifecycle/);
    assert.doesNotMatch(preparationEvidence, new RegExp(owned.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(preparationEvidence, new RegExp(toy.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(await directoryDigest(toy.storeSource), callerStoreBefore);

    const laboratory = await runCompatibilityLab({
      repositoryRoot: toy.root,
      commit: toy.commit,
      offlineStoreSource: toy.storeSource,
      packageManagerCommand: "pnpm",
      expectations: {
        package: { name: "prepared-toy-package", version: "1.0.0", bins: ["prepared-toy"] },
        execution: { bin: "prepared-toy", args: [], exitCode: 0, stdout: "prepared\n" },
      },
    });
    assert.equal(laboratory.observations.preparations.first.tool.pinned, "pnpm@11.3.0");
    assert.equal(laboratory.summary.assertions_passed, true);
  } finally {
    if (previousIgnoreScripts === undefined) delete process.env.npm_config_ignore_scripts;
    else process.env.npm_config_ignore_scripts = previousIgnoreScripts;
    if (previousToken === undefined) delete process.env.NPM_TOKEN;
    else process.env.NPM_TOKEN = previousToken;
  }
});

test("independent snapshots pack identically and expose deterministic package inventory", async (t) => {
  const toy = await makeToyPackage(t);

  if (toy === null) return;
  const before = await sourceState(toy.root);
  const owned = await createOwnedRoot();
  t.after(() => cleanupOwnedRoot({ root: owned.root }));
  const packed = await packPackageTwice({
    repositoryRoot: toy.root,
    commit: toy.commit,
    ownedRoot: owned.root,
  });

  assert.equal(packed.commit, toy.commit);
  assert.equal(packed.tree, toy.tree);
  assert.equal(packed.first.sha256, packed.second.sha256);
  assert.equal(packed.first.byteSize, packed.second.byteSize);
  assert.equal(packed.first.memberListSha256, packed.second.memberListSha256);
  assert.deepEqual(packed.package, {
    name: "toy-package",
    version: "1.2.3",
    declaredBins: [{ name: "toy-command", path: "bin/toy-command.mjs" }],
  });
  assert.ok(packed.first.members.includes("package/package.json"));
  assert.ok(packed.first.members.includes("package/bin/toy-command.mjs"));
  assert.ok(packed.first.members.includes("package/generated-by-prepack.txt"));
  await assert.rejects(stat(path.join(toy.root, "generated-by-prepack.txt")), { code: "ENOENT" });
  assert.equal(packed.first.tool.lifecycleScriptsPolicy, "required");
  assert.equal(path.dirname(packed.tarballPath), path.join(owned.root, "pack-1"));
  assert.deepEqual(await sourceState(toy.root), before);

  const exactBoundaryRoot = await createOwnedRoot();
  t.after(() => cleanupOwnedRoot({ root: exactBoundaryRoot.root }));
  const exactBoundary = await packPackageTwice({
    repositoryRoot: toy.root,
    commit: toy.commit,
    ownedRoot: exactBoundaryRoot.root,
    maxTarInventoryBytes: packed.first.memberListBytes,
  });
  assert.equal(exactBoundary.first.memberListBytes, packed.first.memberListBytes);

  const truncatedRoot = await createOwnedRoot();
  t.after(() => cleanupOwnedRoot({ root: truncatedRoot.root }));
  await assert.rejects(
    packPackageTwice({
      repositoryRoot: toy.root,
      commit: toy.commit,
      ownedRoot: truncatedRoot.root,
      maxTarInventoryBytes: packed.first.memberListBytes - 1,
    }),
    /tar inventory output exceeded bounded capture/i,
  );

  assert.throws(
    () => assertMatchingPacks({ sha256: "a".repeat(64), byteSize: 1 }, { sha256: "b".repeat(64), byteSize: 1 }),
    /independent package bytes differ/i,
  );

  const failureRoot = await createOwnedRoot();
  t.after(() => cleanupOwnedRoot({ root: failureRoot.root }));
  await assert.rejects(
    packPackageTwice({
      repositoryRoot: toy.root,
      commit: toy.commit,
      ownedRoot: failureRoot.root,
      npmCommand: path.join(failureRoot.root, "missing pack tool"),
    }),
    /package tool unavailable/i,
  );
  assert.deepEqual(await sourceState(toy.root), before);
});

test("post-lifecycle packed package identity is inspected from both tarballs", async (t) => {
  const toy = await makeToyPackage(t, "pre-lifecycle-name");

  if (toy === null) return;
  await writeFile(
    path.join(toy.root, "scripts", "prepack.mjs"),
    "import { readFileSync, writeFileSync } from 'node:fs';\nconst pkg = JSON.parse(readFileSync('package.json', 'utf8'));\npkg.name = 'post-lifecycle-name'; pkg.version = '9.9.9'; pkg.bin = { 'post-command': 'bin/toy-command.mjs' };\nwriteFileSync('package.json', JSON.stringify(pkg, null, 2) + '\\n');\n",
  );
  await git(toy.root, ["add", "scripts/prepack.mjs"]);
  await git(toy.root, ["commit", "--quiet", "-m", "mutate packed identity"]);
  const { stdout: commitOutput } = await git(toy.root, ["rev-parse", "HEAD"]);
  const owned = await createOwnedRoot();
  t.after(() => cleanupOwnedRoot({ root: owned.root }));
  const packed = await packPackageTwice({ repositoryRoot: toy.root, commit: commitOutput.trim(), ownedRoot: owned.root });
  const expected = {
    name: "post-lifecycle-name",
    version: "9.9.9",
    declaredBins: [{ name: "post-command", path: "bin/toy-command.mjs" }],
  };
  assert.deepEqual(packed.package, expected);
  assert.deepEqual(packed.first.package, expected);
  assert.deepEqual(packed.second.package, expected);
});
