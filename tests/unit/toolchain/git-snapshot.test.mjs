import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { lstat, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";

import {
  cleanupOwnedRoot,
  createOwnedRoot,
  resolveCommit,
  snapshotCommit,
} from "../../../src/toolchain/index.mjs";
import {
  execFileAsync,
  git,
  makeToyPackage,
  sourceState,
} from "../../helpers/toy-package.mjs";

test("validates a full commit and snapshots only committed content without mutating source", async (t) => {
  const toy = await makeToyPackage(t);

  if (toy === null) return;
  await writeFile(path.join(toy.root, "package.json"), "dirty tracked content\n");
  await writeFile(path.join(toy.root, "untracked ; touch should-not-run"), "untracked\n");
  const before = await sourceState(toy.root);

  const resolved = await resolveCommit({ repositoryRoot: toy.root, commit: toy.commit });
  assert.deepEqual(resolved, { commit: toy.commit, tree: toy.tree });

  const owned = await createOwnedRoot();
  t.after(() => cleanupOwnedRoot({ root: owned.root }));
  const snapshot = path.join(owned.root, "snapshot with spaces ;$() ");
  await snapshotCommit({ repositoryRoot: toy.root, commit: toy.commit, destination: snapshot });
  const snapPackage = JSON.parse(await readFile(path.join(snapshot, "package.json"), "utf8"));
  assert.equal(snapPackage.name, "toy-package");
  await assert.rejects(stat(path.join(snapshot, "untracked ; touch should-not-run")), { code: "ENOENT" });
  assert.deepEqual(await sourceState(toy.root), before);

  await assert.rejects(resolveCommit({ repositoryRoot: toy.root, commit: toy.commit.slice(0, 12) }), /full 40-character/i);
  await assert.rejects(resolveCommit({ repositoryRoot: toy.root, commit: "f".repeat(40) }), /commit object/i);
  await mkdir(path.join(toy.root, "nested"));
  await assert.rejects(resolveCommit({ repositoryRoot: path.join(toy.root, "nested"), commit: toy.commit }), /repository root/i);

  const { stdout: blob } = await git(toy.root, ["rev-parse", `${toy.commit}:package.json`]);
  await assert.rejects(resolveCommit({ repositoryRoot: toy.root, commit: blob.trim() }), /commit object/i);
  assert.deepEqual(await sourceState(toy.root), before);
});

test("snapshot materialization ignores hostile Git hooks, filters, attributes, and autocrlf", async (t) => {
  const toy = await makeToyPackage(t);

  if (toy === null) return;
  await writeFile(path.join(toy.root, ".gitattributes"), "payload.txt filter=hostile text eol=crlf\n");
  await writeFile(path.join(toy.root, "payload.txt"), "blob bytes stay lf\n");
  await git(toy.root, ["add", ".gitattributes", "payload.txt"]);
  await git(toy.root, ["commit", "--quiet", "-m", "tracked attributes"]);
  const { stdout: commitOutput } = await git(toy.root, ["rev-parse", "HEAD"]);
  const commit = commitOutput.trim();
  const { stdout: blobBytes } = await git(toy.root, ["show", `${commit}:payload.txt`]);
  const before = await sourceState(toy.root);

  const hostile = await mkdtemp(path.join(tmpdir(), "visp-git-hostile-"));
  t.after(() => rm(hostile, { recursive: true, force: true }));
  const hooks = path.join(hostile, "hooks");
  const hookMarker = path.join(hostile, "hook-ran");
  const filterMarker = path.join(hostile, "filter-ran");
  const config = path.join(hostile, "gitconfig");
  const attributes = path.join(hostile, "attributes");
  const filter = path.join(hostile, "filter.mjs");
  await mkdir(hooks);
  await writeFile(path.join(hooks, "post-checkout"), `#!/bin/sh\nprintf ran > ${hookMarker}\n`, { mode: 0o755 });
  await writeFile(
    filter,
    `import { readFileSync, writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(filterMarker)}, 'ran');\nprocess.stdout.write(readFileSync(0, 'utf8').toUpperCase());\n`,
  );
  await writeFile(attributes, "payload.txt filter=hostile text eol=crlf\n");
  await execFileAsync("git", ["config", "--file", config, "core.hooksPath", hooks]);
  await execFileAsync("git", ["config", "--file", config, "core.autocrlf", "true"]);
  await execFileAsync("git", ["config", "--file", config, "core.attributesFile", attributes]);
  await execFileAsync("git", ["config", "--file", config, "filter.hostile.smudge", `node ${filter}`]);
  await execFileAsync("git", ["config", "--file", config, "filter.hostile.required", "true"]);

  const hostileEnvironment = {
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.autocrlf",
    GIT_CONFIG_VALUE_0: "true",
  };
  const previous = Object.fromEntries(Object.keys(hostileEnvironment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, hostileEnvironment);
  const owned = await createOwnedRoot();
  t.after(() => cleanupOwnedRoot({ root: owned.root }));
  const destination = path.join(owned.root, "hostile-snapshot");
  try {
    await snapshotCommit({ repositoryRoot: toy.root, commit, destination });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.equal(await readFile(path.join(destination, "payload.txt"), "utf8"), blobBytes);
  await assert.rejects(stat(hookMarker), { code: "ENOENT" });
  await assert.rejects(stat(filterMarker), { code: "ENOENT" });
  assert.deepEqual(await sourceState(toy.root), before);
});

test("snapshot materialization restores exact Git file modes under a restrictive umask", async (t) => {
  // POSIX file modes and umask do not exist on Windows in the form this asserts.
  // Skipping is honest here; the property being checked is a POSIX one.
  if (process.platform === "win32") {
    t.skip("POSIX file modes and umask are not meaningful on Windows");
    return;
  }

  const toy = await makeToyPackage(t);

  if (toy === null) return;
  const owned = await createOwnedRoot();
  t.after(() => cleanupOwnedRoot({ root: owned.root }));
  const destination = path.join(owned.root, "mode-snapshot");
  const previousUmask = process.umask(0o077);
  try {
    await snapshotCommit({ repositoryRoot: toy.root, commit: toy.commit, destination });
  } finally {
    process.umask(previousUmask);
  }
  const regular = await lstat(path.join(destination, "package.json"));
  const executable = await lstat(path.join(destination, "bin", "toy-command.mjs"));
  assert.equal(regular.isFile(), true);
  assert.equal(executable.isFile(), true);
  assert.equal(regular.mode & 0o777, 0o644);
  assert.equal(executable.mode & 0o777, 0o755);
});
