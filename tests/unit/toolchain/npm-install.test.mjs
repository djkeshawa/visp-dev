import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";

import {
  cleanupOwnedRoot,
  createOwnedRoot,
  inspectInstalledBins,
  installLocalTarball,
  packPackageTwice,
  runInstalledBin,
} from "../../../src/toolchain/index.mjs";
import {
  makeToyPackage,
} from "../../helpers/toy-package.mjs";

test("offline local-tarball install disables scripts and confines installed bins", async (t) => {
  const toy = await makeToyPackage(t);

  if (toy === null) return;
  const owned = await createOwnedRoot();
  t.after(() => cleanupOwnedRoot({ root: owned.root }));
  const packed = await packPackageTwice({ repositoryRoot: toy.root, commit: toy.commit, ownedRoot: owned.root });
  const fixture = path.join(owned.root, "install fixture");
  const cacheSource = await mkdtemp(path.join(tmpdir(), "visp-offline-cache-"));
  t.after(() => rm(cacheSource, { recursive: true, force: true }));
  await writeFile(path.join(cacheSource, "seed-marker"), "caller-owned cache seed\n");
  const installed = await installLocalTarball({
    tarballPath: packed.tarballPath,
    fixtureRoot: fixture,
    offlineCacheSource: cacheSource,
  });
  assert.equal(installed.offline, true);
  assert.equal(installed.lifecycleScriptsDisabled, true);
  assert.equal(installed.cache.mode, "caller_snapshot");
  assert.match(installed.cache.inventorySha256, /^[0-9a-f]{64}$/);
  assert.match(installed.dependencyTree.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(installed.dependencyTree.tree.dependencies.map(({ name, version }) => ({ name, version })), [
    { name: "toy-package", version: "1.2.3" },
  ]);
  assert.equal(await readFile(path.join(cacheSource, "seed-marker"), "utf8"), "caller-owned cache seed\n");
  assert.deepEqual(installed.bins.map(({ name }) => name), ["toy-command"]);
  assert.match(installed.bins[0].sha256, /^[0-9a-f]{64}$/);

  const execution = await runInstalledBin({
    fixtureRoot: fixture,
    binName: "toy-command",
    args: ["hello world", "; touch not-run", "$(not-run)"],
  });
  assert.equal(execution.exitCode, 0);
  assert.equal(execution.stdout.text, '{"argv":["hello world","; touch not-run","$(not-run)"],"cwd":"isolated"}\n');
  assert.equal(execution.spawnError, null);

  const outside = path.join(owned.root, "outside-bin");
  await writeFile(outside, "#!/usr/bin/env node\n", { mode: 0o755 });
  const binDir = path.join(fixture, "node_modules", ".bin");
  await symlink(outside, path.join(binDir, "outside"));
  await assert.rejects(inspectInstalledBins({ fixtureRoot: fixture }), /outside install fixture/i);

  await assert.rejects(
    installLocalTarball({
      tarballPath: packed.tarballPath,
      fixtureRoot: path.join(owned.root, "unavailable installer"),
      npmCommand: path.join(owned.root, "missing-npm"),
    }),
    /offline installer unavailable/i,
  );
  await assert.rejects(
    installLocalTarball({
      tarballPath: packed.tarballPath,
      fixtureRoot: path.join(owned.root, "unavailable cache"),
      offlineCacheSource: path.join(owned.root, "missing-cache"),
    }),
    /offline cache source unavailable/i,
  );
});
