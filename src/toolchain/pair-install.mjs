/**
 * Packing and installing ONE side of the pair, ready to be executed.
 *
 * The result is a real installed command plus a capture shim, so a suite drives
 * the binary a user would get rather than the source tree it was built from.
 */
import { mkdir, access, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createOwnedRoot } from "./owned-root.mjs";
import { runProcess } from "./process.mjs";
import { packPackageTwice } from "./npm-pack.mjs";
import { installLocalTarball } from "./npm-install.mjs";
import { materializeRuntimeInstallLock } from "./runtime-lock.mjs";

/**
 * The command a package installs. Kit released `visp` to Hyper in 0.4.0, so the
 * name is a property of the *pair under test*, not of the role. Callers testing
 * a post-rename pair must pass `binName` explicitly; the default preserves the
 * pre-rename naming the historical pinned suites depend on.
 */
export function defaultBinName(kind) {
  return kind === "kit" ? "visp" : "visp-hyper";
}

export async function toolVersion(command) {
  const result = await runProcess(command, ["--version"], { timeoutMs: 30_000 });
  if (result.spawnError || result.timedOut || result.exitCode !== 0) {
    throw new Error(`Cannot determine ${command} version`);
  }
  return result.stdout.text.trim();
}

export async function pathCommand(name) {
  // On Windows the file on PATH is `git.exe`, not `git`. PATHEXT is the
  // platform's own list of executable suffixes; the bare name stays first
  // because an extensionless executable on PATH is still valid.
  const candidates =
    process.platform === "win32"
      ? [
          name,
          ...(process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
            .split(";")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
            .map((extension) => `${name}${extension}`)
        ]
      : [name];

  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    for (const candidateName of candidates) {
      const candidate = path.join(directory, candidateName);
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Continue through the caller's executable search path.
      }
    }
  }
  throw new Error(`Required pair executable unavailable: ${name}`);
}

/** Fixed locale, no colour, and a PATH holding only the pair and Node. */
export function executionEnvironment(kit, hyper, gitExecutable) {
  return {
    CI: "1",
    FORCE_COLOR: "0",
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "1",
    PATH: [
      path.dirname(kit.executable),
      path.dirname(hyper.executable),
      path.dirname(process.execPath),
      path.dirname(gitExecutable),
    ].join(path.delimiter),
    TZ: "UTC",
  };
}

function publicPack(pack) {
  return {
    byteSize: pack.byteSize,
    memberListSha256: pack.memberListSha256,
    members: pack.members,
    package: pack.package,
    sha256: pack.sha256,
    tool: pack.tool,
  };
}

export async function packAndInstall({
  definition,
  kind,
  binName,
  offlineCacheSource,
  offlineStoreSource,
  npmCommand,
  ownedRoot,
  packageManagerCommand,
  repositoryRoot,
}) {
  const expectedBin = binName ?? defaultBinName(kind);
  const packageRoot = await createOwnedRoot({ baseDirectory: ownedRoot });
  const packed = await packPackageTwice({
    repositoryRoot,
    commit: definition.commit,
    ownedRoot: packageRoot.root,
    offlineStoreSource,
    packageManagerCommand,
    npmCommand,
  });
  if (packed.commit !== definition.commit || packed.tree !== definition.tree) {
    throw new Error(`Pair ${kind} source identity drifted during packing`);
  }
  const runtimeLockPath = path.join(packageRoot.root, "runtime-package-lock.json");
  const runtimeLock = await materializeRuntimeInstallLock({
    outputPath: runtimeLockPath,
    package: packed.package,
    tarballPath: packed.tarballPath,
  });
  const fixture = path.join(packageRoot.root, "install");
  const install = await installLocalTarball({
    tarballPath: packed.tarballPath,
    fixtureRoot: fixture,
    npmCommand,
    offlineCacheSource,
    offlineInstallLockSource: runtimeLockPath,
  });
  const installedExecutable = path.join(fixture, "node_modules", ".bin", expectedBin);

  // Fail loudly when the expected command is absent. Without this the harness
  // spawns a nonexistent path, every invocation exits non-zero with ENOENT, and
  // fixtures that treat "non-zero exit" as the desired outcome — a refused path
  // traversal, an inert injection payload — record `pass` while testing
  // nothing. A rename must break this suite honestly, not quietly bless it.
  const installedNames = (install?.bins ?? []).map((entry) => entry.name);
  if (!installedNames.includes(expectedBin)) {
    throw new Error(
      `Expected ${kind} package to install the "${expectedBin}" command, but it installed ` +
        `${installedNames.length === 0 ? "no commands" : installedNames.map((n) => `"${n}"`).join(", ")}. ` +
        "Pass the correct binName for the pair under test; do not run fixtures against a missing binary.",
    );
  }

  const captureBin = path.join(packageRoot.root, "capture-bin");
  await mkdir(captureBin);
  // The shim's filename is also the command name: anything resolving a bare
  // command from PATH (a generated git hook, a CI workflow) depends on it.
  const capturedExecutable = path.join(captureBin, expectedBin);
  await writeFile(
    capturedExecutable,
    [
      "#!/usr/bin/env node",
      'import { spawnSync } from "node:child_process";',
      'import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";',
      'import { tmpdir } from "node:os";',
      'import { join } from "node:path";',
      'const root = mkdtempSync(join(tmpdir(), "visp-pair-cli-output-"));',
      'const stdoutPath = join(root, "stdout");',
      'const stderrPath = join(root, "stderr");',
      'const stdout = openSync(stdoutPath, "w");',
      'const stderr = openSync(stderrPath, "w");',
      `const result = spawnSync(${JSON.stringify(installedExecutable)}, process.argv.slice(2), {`,
      '  env: process.env, stdio: ["inherit", stdout, stderr],',
      "});",
      "closeSync(stdout);",
      "closeSync(stderr);",
      "writeSync(1, readFileSync(stdoutPath));",
      "writeSync(2, readFileSync(stderrPath));",
      "rmSync(root, { force: true, recursive: true });",
      "if (result.error) throw result.error;",
      "if (result.signal) process.kill(process.pid, result.signal);",
      "else process.exitCode = result.status ?? 1;",
      "",
    ].join("\n"),
    { flag: "wx", mode: 0o700 },
  );
  return {
    executable: capturedExecutable,
    fixture,
    report: {
      install,
      pack: {
        byteEquality: true,
        first: publicPack(packed.first),
        second: publicPack(packed.second),
      },
      runtimeLock,
      source: { commit: packed.commit, tree: packed.tree },
    },
  };
}
