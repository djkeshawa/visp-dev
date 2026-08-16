/**
 * Real Git repositories and real packed artifacts, small enough to run in a test.
 *
 * `makeToyPackage` commits a package at a known tree so a suite can pin a
 * commit; `makeRegistryArtifact` builds the tarballs a closed offline lock
 * graph resolves to. Shared rather than copied: two copies of a fixture drift,
 * and a suite that silently builds a different package proves something else.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { lstat, mkdtemp, mkdir, readFile, readdir, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";

import {
  canonicalStringify,
  sha256Hex,
  snapshotFidelityAvailable,
} from "../../src/toolchain/index.mjs";

const execFileAsync = promisify(execFile);

async function git(cwd, args) {
  return execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
}

async function makeToyPackage(t, name = "toy-package") {
  if (!snapshotFidelityAvailable()) {
    t.skip("mode-faithful snapshots are not reproducible on this platform");
    return null;
  }

  const root = await mkdtemp(path.join(tmpdir(), "visp lab source ;$() "));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, ["init", "--quiet"]);
  await git(root, ["config", "user.name", "Visp Test"]);
  await git(root, ["config", "user.email", "visp-test@example.invalid"]);

  const packageJson = {
    name,
    version: "1.2.3",
    type: "module",
    bin: { "toy-command": "bin/toy-command.mjs" },
    scripts: { prepack: "node scripts/prepack.mjs" },
  };
  await mkdir(path.join(root, "bin"));
  await mkdir(path.join(root, "scripts"));
  await writeFile(path.join(root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  await writeFile(
    path.join(root, "bin", "toy-command.mjs"),
    "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ argv: process.argv.slice(2), cwd: 'isolated' }) + '\\n');\n",
    { mode: 0o755 },
  );
  await writeFile(path.join(root, "scripts", "prepack.mjs"), "import { writeFileSync } from 'node:fs';\nwriteFileSync('generated-by-prepack.txt', 'generated in disposable snapshot\\n');\n");
  await git(root, ["add", "package.json", "bin/toy-command.mjs", "scripts/prepack.mjs"]);
  await git(root, ["commit", "--quiet", "-m", "toy package"]);
  const { stdout: commit } = await git(root, ["rev-parse", "HEAD"]);
  const { stdout: tree } = await git(root, ["show", "-s", "--format=%T", "HEAD"]);
  return { root, commit: commit.trim(), tree: tree.trim() };
}

async function sourceState(root) {
  const [{ stdout: head }, { stdout: status }] = await Promise.all([
    git(root, ["rev-parse", "HEAD"]),
    git(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
  ]);
  return { head, status };
}

async function makeRegistryArtifact(t, name, version, executableName, executableSource, packageFields = {}) {
  if (!snapshotFidelityAvailable()) {
    t.skip("mode-faithful snapshots are not reproducible on this platform");
    return null;
  }

  const root = await mkdtemp(path.join(tmpdir(), "visp registry artifact "));
  const output = await mkdtemp(path.join(tmpdir(), "visp registry tarball "));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(output, { recursive: true, force: true }));
  await mkdir(path.join(root, "bin"));
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({
    ...packageFields,
    name,
    version,
    bin: executableName ? { [executableName]: `bin/${executableName}.mjs` } : undefined,
  }, null, 2)}\n`);
  if (executableName) {
    await writeFile(path.join(root, "bin", `${executableName}.mjs`), executableSource, { mode: 0o755 });
  }
  await execFileAsync("npm", ["pack", "--ignore-scripts", "--pack-destination", output], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  // GREP-EXEMPT(record-loader): this reads a packed tarball out of a build output directory. No
  // record, no holdout, no scoring — the shape is a coincidence of listing files.
  const [filename] = (await readdir(output)).filter((entry) => entry.endsWith(".tgz"));
  const tarball = path.join(output, filename);
  const integrity = `sha512-${createHash("sha512").update(await readFile(tarball)).digest("base64")}`;
  return { integrity, tarball };
}

async function directoryDigest(root) {
  const records = [];
  async function walk(directory, relativeDirectory) {
    const entries = (await readdir(directory)).sort();
    for (const entry of entries) {
      const absolute = path.join(directory, entry);
      const relative = path.posix.join(relativeDirectory, entry);
      const metadata = await lstat(absolute);
      if (metadata.isDirectory()) {
        records.push({ path: `${relative}/`, type: "directory" });
        await walk(absolute, relative);
      } else if (metadata.isSymbolicLink()) {
        records.push({ path: relative, target: await readlink(absolute), type: "symlink" });
      } else {
        records.push({ path: relative, sha256: sha256Hex(await readFile(absolute)), type: "file" });
      }
    }
  }
  await walk(root, "");
  return sha256Hex(canonicalStringify(records));
}

async function pathExecutable(name) {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      const metadata = await stat(candidate);
      if (metadata.isFile()) return candidate;
    } catch {
      // Continue through the caller's explicit PATH.
    }
  }
  throw new Error(`Required test executable unavailable: ${name}`);
}

export {
  directoryDigest,
  execFileAsync,
  git,
  makeRegistryArtifact,
  makeToyPackage,
  pathExecutable,
  sourceState,
};
