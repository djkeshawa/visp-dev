import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";

import {
  cleanupOwnedRoot,
  createOwnedRoot,
  installLocalTarball,
  packPackageTwice,
  sha256Hex,
} from "../../../../src/toolchain/index.mjs";
import {
  directoryDigest,
  execFileAsync,
  git,
  makeRegistryArtifact,
  makeToyPackage,
} from "../../../helpers/toy-package.mjs";

test("caller npm cache hydrates only a closed reachable registry lock graph offline", async (t) => {
  const toy = await makeToyPackage(t, "cache-hydration-package");

  if (toy === null) return;
  const leafOne = await makeRegistryArtifact(t, "@visp/graph-leaf", "1.4.0", null, null);

  if (leafOne === null) return;
  const leafTwo = await makeRegistryArtifact(t, "@visp/graph-leaf", "2.3.0", null, null);

  if (leafTwo === null) return;
  const child = await makeRegistryArtifact(t, "visp-graph-child", "0.2.9", null, null);

  if (child === null) return;
  const zeroPatch = await makeRegistryArtifact(t, "visp-zero-patch", "0.0.3", null, null);

  if (zeroPatch === null) return;
  const parent = await makeRegistryArtifact(t, "visp-graph-parent", "1.2.3", null, null, {
    dependencies: { "@visp/graph-leaf": "^2.0.0", "visp-graph-child": "^0.2.3", "visp-zero-patch": "^0.0.3" },
  });
  const commander = await makeRegistryArtifact(t, "commander", "12.1.0", null, null);

  if (commander === null) return;
  const zod = await makeRegistryArtifact(t, "zod", "3.25.76", null, null);

  if (zod === null) return;
  const exact = await makeRegistryArtifact(t, "visp-graph-exact", "4.5.6", null, null);

  if (exact === null) return;
  const extraneous = await makeRegistryArtifact(t, "visp-graph-extraneous", "1.0.0", null, null);

  if (extraneous === null) return;
  const impostor = await makeRegistryArtifact(t, "visp-graph-impostor", "0.2.9", null, null);

  if (impostor === null) return;
  const cacheSource = await mkdtemp(path.join(tmpdir(), "visp populated npm cache "));
  t.after(() => rm(cacheSource, { recursive: true, force: true }));
  const cacheLogs = await mkdtemp(path.join(tmpdir(), "visp npm cache logs "));
  t.after(() => rm(cacheLogs, { recursive: true, force: true }));
  for (const artifact of [leafOne, leafTwo, child, zeroPatch, parent, commander, zod, exact, extraneous, impostor]) {
    await execFileAsync("npm", [
      "cache",
      "add",
      artifact.tarball,
      "--cache",
      cacheSource,
      "--offline",
      "--ignore-scripts",
      "--logs-dir",
      cacheLogs,
      "--logs-max=0",
      "--update-notifier=false",
    ], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  }
  const callerCacheBefore = await directoryDigest(cacheSource);
  // GREP-EXEMPT(record-loader): this counts entries in an npm cache directory this
  // test just populated with its own toy tarballs. It reads no holdout record and
  // produces no score. The exemption used to be carried by the single 2008-line
  // compatibility-lab suite this file was split out of; the split moved the
  // readdir away from the comment, which is exactly the accident the tripwire
  // exists to catch.
  assert.ok((await readdir(cacheSource)).length > 0);

  const packageJsonPath = path.join(toy.root, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  packageJson.dependencies = {
    "@visp/graph-leaf": "^1.0.0",
    commander: "^12.1.0",
    "visp-graph-exact": "4.5.6",
    "visp-graph-parent": "^1.0.0",
    zod: "^3.25.76",
  };
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  await writeFile(path.join(toy.root, "npm-shrinkwrap.json"), `${JSON.stringify({
    name: "cache-hydration-package",
    version: "1.2.3",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "cache-hydration-package", version: "1.2.3", dependencies: packageJson.dependencies },
      "node_modules/@visp/graph-leaf": {
        version: "1.4.0",
        resolved: "https://registry.npmjs.org/@visp/graph-leaf/-/graph-leaf-1.4.0.tgz",
        integrity: leafOne.integrity,
      },
      "node_modules/visp-graph-child": {
        version: "0.2.9",
        resolved: "https://registry.npmjs.org/visp-graph-child/-/visp-graph-child-0.2.9.tgz",
        integrity: child.integrity,
      },
      "node_modules/visp-graph-parent": {
        version: "1.2.3",
        resolved: "https://registry.npmjs.org/visp-graph-parent/-/visp-graph-parent-1.2.3.tgz",
        integrity: parent.integrity,
        dependencies: { "@visp/graph-leaf": "^2.0.0", "visp-graph-child": "^0.2.3", "visp-zero-patch": "^0.0.3" },
      },
      "node_modules/visp-graph-parent/node_modules/@visp/graph-leaf": {
        version: "2.3.0",
        resolved: "https://registry.npmjs.org/@visp/graph-leaf/-/graph-leaf-2.3.0.tgz",
        integrity: leafTwo.integrity,
      },
      "node_modules/commander": {
        version: "12.1.0",
        resolved: "https://registry.npmjs.org/commander/-/commander-12.1.0.tgz",
        integrity: commander.integrity,
      },
      "node_modules/visp-zero-patch": {
        version: "0.0.3",
        resolved: "https://registry.npmjs.org/visp-zero-patch/-/visp-zero-patch-0.0.3.tgz",
        integrity: zeroPatch.integrity,
      },
      "node_modules/visp-graph-exact": {
        version: "4.5.6",
        resolved: "https://registry.npmjs.org/visp-graph-exact/-/visp-graph-exact-4.5.6.tgz",
        integrity: exact.integrity,
      },
      "node_modules/zod": {
        version: "3.25.76",
        resolved: "https://registry.npmjs.org/zod/-/zod-3.25.76.tgz",
        integrity: zod.integrity,
      },
    },
  }, null, 2)}\n`);
  await git(toy.root, ["add", "package.json", "npm-shrinkwrap.json"]);
  await git(toy.root, ["commit", "--quiet", "-m", "registry-style runtime dependency"]);
  const { stdout: commitOutput } = await git(toy.root, ["rev-parse", "HEAD"]);
  const owned = await createOwnedRoot();
  t.after(() => cleanupOwnedRoot({ root: owned.root }));
  const packed = await packPackageTwice({ repositoryRoot: toy.root, commit: commitOutput.trim(), ownedRoot: owned.root });
  const installLockRoot = await mkdtemp(path.join(tmpdir(), "visp offline install lock "));
  t.after(() => rm(installLockRoot, { recursive: true, force: true }));
  const installLockSource = path.join(installLockRoot, "package-lock.json");
  const packedIntegrity = `sha512-${createHash("sha512").update(await readFile(packed.tarballPath)).digest("base64")}`;
  const baseLock = {
    name: "visp-compatibility-install",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "visp-compatibility-install",
        private: true,
        dependencies: { "cache-hydration-package": "file:__VISP_LOCAL_TARBALL__" },
      },
      "node_modules/cache-hydration-package": {
        version: "1.2.3",
        resolved: "file:__VISP_LOCAL_TARBALL__",
        integrity: packedIntegrity,
        dependencies: packageJson.dependencies,
        bin: { "toy-command": "bin/toy-command.mjs" },
      },
      "node_modules/@visp/graph-leaf": {
        version: "1.4.0",
        resolved: "https://registry.npmjs.org/@visp/graph-leaf/-/graph-leaf-1.4.0.tgz",
        integrity: leafOne.integrity,
      },
      "node_modules/visp-graph-child": {
        version: "0.2.9",
        resolved: "https://registry.npmjs.org/visp-graph-child/-/visp-graph-child-0.2.9.tgz",
        integrity: child.integrity,
      },
      "node_modules/visp-graph-parent": {
        version: "1.2.3",
        resolved: "https://registry.npmjs.org/visp-graph-parent/-/visp-graph-parent-1.2.3.tgz",
        integrity: parent.integrity,
        dependencies: { "@visp/graph-leaf": "^2.0.0", "visp-graph-child": "^0.2.3", "visp-zero-patch": "^0.0.3" },
      },
      "node_modules/visp-graph-parent/node_modules/@visp/graph-leaf": {
        version: "2.3.0",
        resolved: "https://registry.npmjs.org/@visp/graph-leaf/-/graph-leaf-2.3.0.tgz",
        integrity: leafTwo.integrity,
      },
      "node_modules/commander": {
        version: "12.1.0",
        resolved: "https://registry.npmjs.org/commander/-/commander-12.1.0.tgz",
        integrity: commander.integrity,
      },
      "node_modules/visp-zero-patch": {
        version: "0.0.3",
        resolved: "https://registry.npmjs.org/visp-zero-patch/-/visp-zero-patch-0.0.3.tgz",
        integrity: zeroPatch.integrity,
      },
      "node_modules/visp-graph-exact": {
        version: "4.5.6",
        resolved: "https://registry.npmjs.org/visp-graph-exact/-/visp-graph-exact-4.5.6.tgz",
        integrity: exact.integrity,
      },
      "node_modules/zod": {
        version: "3.25.76",
        resolved: "https://registry.npmjs.org/zod/-/zod-3.25.76.tgz",
        integrity: zod.integrity,
      },
    },
  };
  await writeFile(installLockSource, `${JSON.stringify(baseLock, null, 2)}\n`);
  const callerLockBefore = await readFile(installLockSource);
  let invalidIndex = 0;
  const rejectLock = async (label, mutate, pattern) => {
    invalidIndex += 1;
    const candidate = structuredClone(baseLock);
    mutate(candidate);
    const source = path.join(installLockRoot, `invalid-${invalidIndex}.json`);
    await writeFile(source, `${JSON.stringify(candidate, null, 2)}\n`);
    await assert.rejects(
      installLocalTarball({
        tarballPath: packed.tarballPath,
        fixtureRoot: path.join(owned.root, `invalid-${invalidIndex}`),
        offlineCacheSource: cacheSource,
        offlineInstallLockSource: source,
      }),
      pattern,
      label,
    );
  };
  const childEntry = (lock) => lock.packages["node_modules/visp-graph-child"];
  const canonicalChildUrl = childEntry(baseLock).resolved;
  const invalidUrls = [
    "https://registry.npmjs.org:444/visp-graph-child/-/visp-graph-child-0.2.9.tgz",
    `${canonicalChildUrl}?download=1`,
    `${canonicalChildUrl}#fragment`,
    "https://user:pass@registry.npmjs.org/visp-graph-child/-/visp-graph-child-0.2.9.tgz",
    "https://registry.npmjs.org/other/-/other-1.0.0.tgz",
    "https://registry.npmjs.org/visp-graph-child/../other/-/other-1.0.0.tgz",
    "https://registry.npmjs.org/visp-graph%2fchild/-/visp-graph-child-0.2.9.tgz",
  ];
  for (const resolved of invalidUrls) {
    await rejectLock(
      "rejects non-canonical registry artifact URL",
      (lock) => { childEntry(lock).resolved = resolved; },
      /canonical npm registry artifact URL|unsafe encoded path/i,
    );
  }
  await rejectLock("rejects a misplaced dependency", (lock) => {
    lock.packages["node_modules/unrelated/node_modules/visp-graph-child"] = childEntry(lock);
    delete lock.packages["node_modules/visp-graph-child"];
  }, /dependency graph/i);
  await rejectLock("rejects an extraneous package", (lock) => {
    lock.packages["node_modules/visp-graph-extraneous"] = {
      version: "1.0.0",
      resolved: "https://registry.npmjs.org/visp-graph-extraneous/-/visp-graph-extraneous-1.0.0.tgz",
      integrity: extraneous.integrity,
    };
  }, /extraneous/i);
  await rejectLock("rejects an ambiguous dependency declaration", (lock) => {
    lock.packages["node_modules/visp-graph-parent"].optionalDependencies = { "visp-graph-child": "^0.3.0" };
  }, /ambiguous/i);
  await rejectLock("rejects a wrong-major caret resolution", (lock) => {
    const entry = lock.packages["node_modules/visp-graph-parent"];
    entry.version = "2.0.0";
    entry.resolved = "https://registry.npmjs.org/visp-graph-parent/-/visp-graph-parent-2.0.0.tgz";
  }, /does not satisfy authored dependency spec/i);
  await rejectLock("rejects an out-of-range zero-major caret resolution", (lock) => {
    const entry = lock.packages["node_modules/visp-graph-child"];
    entry.version = "0.3.0";
    entry.resolved = "https://registry.npmjs.org/visp-graph-child/-/visp-graph-child-0.3.0.tgz";
  }, /does not satisfy authored dependency spec/i);
  await rejectLock("rejects an out-of-range zero-minor caret resolution", (lock) => {
    const entry = lock.packages["node_modules/visp-zero-patch"];
    entry.version = "0.0.4";
    entry.resolved = "https://registry.npmjs.org/visp-zero-patch/-/visp-zero-patch-0.0.4.tgz";
  }, /does not satisfy authored dependency spec/i);
  await rejectLock("rejects unsupported range syntax", (lock) => {
    lock.packages["node_modules/visp-graph-parent"].dependencies["visp-graph-child"] = "~0.2.3";
  }, /unsupported dependency spec/i);
  await rejectLock("rejects prerelease caret syntax", (lock) => {
    lock.packages["node_modules/visp-graph-parent"].dependencies["visp-graph-child"] = "^0.2.3-beta.1";
  }, /prerelease dependency specs are unsupported/i);
  await rejectLock("rejects an installed artifact with a mismatched manifest identity", (lock) => {
    childEntry(lock).integrity = impostor.integrity;
  }, /installed package identity/i);
  await rejectLock("rejects omitted local package bins", (lock) => {
    delete lock.packages["node_modules/cache-hydration-package"].bin;
  }, /local package bin metadata/i);
  await rejectLock("rejects rewritten local package bins", (lock) => {
    lock.packages["node_modules/cache-hydration-package"].bin = {
      "different-command": "bin/toy-command.mjs",
    };
  }, /local package bin metadata/i);
  const emptyCache = await mkdtemp(path.join(tmpdir(), "visp empty npm cache "));
  t.after(() => rm(emptyCache, { recursive: true, force: true }));
  await assert.rejects(
    installLocalTarball({
      tarballPath: packed.tarballPath,
      fixtureRoot: path.join(owned.root, "empty-cache-install"),
      offlineCacheSource: emptyCache,
      offlineInstallLockSource: installLockSource,
    }),
    (error) => error.code === "OFFLINE_INSTALL_FAILED" && /ENOTCACHED/u.test(error.observation.stderr.text),
  );
  const installed = await installLocalTarball({
    tarballPath: packed.tarballPath,
    fixtureRoot: path.join(owned.root, "populated-cache-install"),
    offlineCacheSource: cacheSource,
    offlineInstallLockSource: installLockSource,
  });
  const identities = [];
  const collectIdentities = (node) => {
    identities.push(`${node.name}@${node.version}`);
    for (const dependency of node.dependencies) collectIdentities(dependency);
  };
  collectIdentities(installed.dependencyTree.tree);
  assert.deepEqual([...new Set(identities)].sort(), [
    "@visp/graph-leaf@1.4.0",
    "@visp/graph-leaf@2.3.0",
    "cache-hydration-package@1.2.3",
    "commander@12.1.0",
    "visp-compatibility-install@null",
    "visp-graph-child@0.2.9",
    "visp-graph-exact@4.5.6",
    "visp-graph-parent@1.2.3",
    "visp-zero-patch@0.0.3",
    "zod@3.25.76",
  ]);
  assert.equal(installed.installLock.path, "package-lock.json");
  assert.equal(installed.installLock.sha256, sha256Hex(callerLockBefore));
  assert.equal(installed.installLock.packages.length, 9);
  assert.match(installed.installLock.graphSha256, /^[0-9a-f]{64}$/);
  assert.match(installed.installLock.edgeSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    installed.installLock.edges.filter(({ ownerKey }) => ownerKey === "node_modules/cache-hydration-package"),
    [
      {
        ownerKey: "node_modules/cache-hydration-package",
        requestedName: "@visp/graph-leaf",
        requestedSpec: "^1.0.0",
        resolvedKey: "node_modules/@visp/graph-leaf",
        resolvedVersion: "1.4.0",
      },
      {
        ownerKey: "node_modules/cache-hydration-package",
        requestedName: "commander",
        requestedSpec: "^12.1.0",
        resolvedKey: "node_modules/commander",
        resolvedVersion: "12.1.0",
      },
      {
        ownerKey: "node_modules/cache-hydration-package",
        requestedName: "visp-graph-exact",
        requestedSpec: "4.5.6",
        resolvedKey: "node_modules/visp-graph-exact",
        resolvedVersion: "4.5.6",
      },
      {
        ownerKey: "node_modules/cache-hydration-package",
        requestedName: "visp-graph-parent",
        requestedSpec: "^1.0.0",
        resolvedKey: "node_modules/visp-graph-parent",
        resolvedVersion: "1.2.3",
      },
      {
        ownerKey: "node_modules/cache-hydration-package",
        requestedName: "zod",
        requestedSpec: "^3.25.76",
        resolvedKey: "node_modules/zod",
        resolvedVersion: "3.25.76",
      },
    ],
  );
  assert.deepEqual(await readFile(installLockSource), callerLockBefore);
  assert.equal(await directoryDigest(cacheSource), callerCacheBefore);
});
