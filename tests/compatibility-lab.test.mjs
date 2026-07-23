import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, mkdir, readFile, readdir, readlink, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assertMatchingPacks,
  canonicalStringify,
  cleanupOwnedRoot,
  createOwnedRoot,
  inspectInstalledBins,
  installLocalTarball,
  packPackageTwice,
  resolveCommit,
  runCompatibilityLab,
  runInstalledBin,
  runProcess,
  sha256Hex,
  snapshotCommit,
} from "../src/compatibility-lab.mjs";

const execFileAsync = promisify(execFile);

async function git(cwd, args) {
  return execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
}

async function makeToyPackage(t, name = "toy-package") {
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

async function makePreparedToyPackage(t, { dependencyGroup = "devDependencies" } = {}) {
  assert.ok(["devDependencies", "optionalDependencies"].includes(dependencyGroup));
  const root = await mkdtemp(path.join(tmpdir(), "visp prepared source "));
  const seedRoot = await mkdtemp(path.join(tmpdir(), "visp pnpm seed "));
  const storeSource = path.join(seedRoot, "caller-store");
  const seedConsumer = path.join(seedRoot, "consumer");
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(seedRoot, { recursive: true, force: true }));
  const builder = await makeRegistryArtifact(
    t,
    "visp-toy-builder-offline",
    "1.0.0",
    "toy-builder",
    "#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nif (process.env.NPM_TOKEN || process.env.npm_config_ignore_scripts === 'true') process.exit(97);\nwriteFileSync('generated-by-dev-dependency.txt', 'prepared offline\\n');\n",
  );
  await mkdir(seedConsumer);
  const seedTarball = path.join(seedRoot, "artifact.tgz");
  await writeFile(seedTarball, await readFile(builder.tarball));
  await writeFile(path.join(seedConsumer, "package.json"), `${JSON.stringify({
    name: "pnpm-offline-store-seed",
    version: "1.0.0",
    private: true,
    devDependencies: { "visp-toy-builder-offline": "1.0.0" },
  }, null, 2)}\n`);
  await writeFile(path.join(seedConsumer, "pnpm-lock.yaml"), `lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .:\n    devDependencies:\n      visp-toy-builder-offline:\n        specifier: 1.0.0\n        version: 1.0.0\n\npackages:\n\n  visp-toy-builder-offline@1.0.0:\n    resolution: {integrity: ${builder.integrity}, tarball: file:../artifact.tgz}\n    hasBin: true\n\nsnapshots:\n\n  visp-toy-builder-offline@1.0.0: {}\n`);
  await execFileAsync("pnpm", [
    "install",
    "--offline",
    "--frozen-lockfile",
    "--trust-lockfile",
    "--ignore-scripts",
    "--package-import-method",
    "copy",
    "--store-dir",
    storeSource,
    "--virtual-store-dir",
    path.join(seedConsumer, "node_modules", ".pnpm"),
  ], {
    cwd: seedConsumer,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  await rm(path.join(seedConsumer, "node_modules"), { recursive: true, force: true });
  await rm(seedTarball);
  await rm(path.join(storeSource, "v11", "projects"), { recursive: true, force: true });
  await git(root, ["init", "--quiet"]);
  await git(root, ["config", "user.name", "Visp Test"]);
  await git(root, ["config", "user.email", "visp-test@example.invalid"]);
  await mkdir(path.join(root, "bin"), { recursive: true });
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({
    name: "prepared-toy-package",
    version: "1.0.0",
    private: true,
    type: "module",
    packageManager: "pnpm@11.3.0",
    bin: { "prepared-toy": "bin/prepared-toy.mjs" },
    scripts: { prepack: "toy-builder" },
    [dependencyGroup]: { "visp-toy-builder-offline": "1.0.0" },
  }, null, 2)}\n`);
  await writeFile(path.join(root, "bin", "prepared-toy.mjs"), "#!/usr/bin/env node\nprocess.stdout.write('prepared\\n');\n", { mode: 0o755 });
  await writeFile(path.join(root, "pnpm-lock.yaml"), `lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .:\n    ${dependencyGroup}:\n      visp-toy-builder-offline:\n        specifier: 1.0.0\n        version: 1.0.0\n\npackages:\n\n  visp-toy-builder-offline@1.0.0:\n    resolution: {integrity: ${builder.integrity}}\n    hasBin: true\n\nsnapshots:\n\n  visp-toy-builder-offline@1.0.0: {}\n`);
  await git(root, ["add", "package.json", "pnpm-lock.yaml", "bin"]);
  await git(root, ["commit", "--quiet", "-m", "prepared toy package"]);
  const { stdout: commit } = await git(root, ["rev-parse", "HEAD"]);
  const { stdout: tree } = await git(root, ["show", "-s", "--format=%T", "HEAD"]);
  return { root, storeSource, commit: commit.trim(), tree: tree.trim() };
}

async function makeOptionalPreparedToyPackage(t) {
  assert.equal(process.platform, "linux", "the pinned-pnpm optional fixture is calibrated for the Linux compatibility lane");
  const root = await mkdtemp(path.join(tmpdir(), "visp optional prepared source "));
  const seedRoot = await mkdtemp(path.join(tmpdir(), "visp optional pnpm seed "));
  const storeSource = path.join(seedRoot, "caller-store");
  const seedConsumer = path.join(seedRoot, "consumer");
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(seedRoot, { recursive: true, force: true }));

  const incompatibleOs = process.platform === "darwin" ? "linux" : "darwin";
  const incompatibleCpu = process.arch === "arm64" ? "x64" : "arm64";
  const runtimeReport = process.report?.getReport?.();
  const incompatibleLibc = runtimeReport?.header?.glibcVersionRuntime ? "musl" : "glibc";
  const definitions = [
    {
      name: "visp-optional-applicable",
      fields: {},
    },
    {
      name: "visp-optional-cpu-incompatible",
      fields: { cpu: [incompatibleCpu] },
    },
    {
      name: "visp-optional-libc-incompatible",
      fields: { libc: [incompatibleLibc], os: ["linux"] },
    },
    {
      name: "visp-optional-os-incompatible",
      fields: { os: [incompatibleOs] },
    },
  ];
  const builder = await makeRegistryArtifact(
    t,
    "visp-optional-toy-builder",
    "1.0.0",
    "optional-toy-builder",
    "#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync('generated-by-optional-builder.txt', 'prepared offline\\n');\n",
  );
  const artifacts = new Map();
  for (const definition of definitions) {
    artifacts.set(
      definition.name,
      await makeRegistryArtifact(t, definition.name, "1.0.0", null, null, definition.fields),
    );
  }

  await mkdir(seedConsumer);
  const allArtifacts = [
    { name: "visp-optional-toy-builder", artifact: builder, fields: { hasBin: true } },
    ...definitions.map((definition) => ({
      name: definition.name,
      artifact: artifacts.get(definition.name),
      fields: definition.fields,
    })),
  ];
  for (const { name, artifact } of allArtifacts) {
    await writeFile(path.join(seedRoot, `${name}.tgz`), await readFile(artifact.tarball));
  }
  const dependencyEntries = Object.fromEntries(allArtifacts.map(({ name }) => [name, "1.0.0"]));
  await writeFile(path.join(seedConsumer, "package.json"), `${JSON.stringify({
    name: "pnpm-optional-offline-store-seed",
    version: "1.0.0",
    private: true,
    dependencies: dependencyEntries,
  }, null, 2)}\n`);
  const seedImporter = allArtifacts
    .map(({ name }) => `      ${name}:\n        specifier: 1.0.0\n        version: 1.0.0`)
    .join("\n");
  const seedPackages = allArtifacts
    .map(({ name, artifact, fields }) => {
      const metadata = Object.entries(fields)
        .map(([key, value]) => `    ${key}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`)
        .join("\n");
      return `  ${name}@1.0.0:\n    resolution: {integrity: ${artifact.integrity}, tarball: file:../${name}.tgz}${metadata ? `\n${metadata}` : ""}`;
    })
    .join("\n\n");
  const seedSnapshots = allArtifacts.map(({ name }) => `  ${name}@1.0.0: {}`).join("\n\n");
  await writeFile(path.join(seedConsumer, "pnpm-lock.yaml"), `lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .:\n    dependencies:\n${seedImporter}\n\npackages:\n\n${seedPackages}\n\nsnapshots:\n\n${seedSnapshots}\n`);
  await execFileAsync("pnpm", [
    "install",
    "--force",
    "--offline",
    "--frozen-lockfile",
    "--trust-lockfile",
    "--ignore-scripts",
    "--package-import-method",
    "copy",
    "--store-dir",
    storeSource,
    "--virtual-store-dir",
    path.join(seedConsumer, "node_modules", ".pnpm"),
  ], {
    cwd: seedConsumer,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  await rm(path.join(seedConsumer, "node_modules"), { recursive: true, force: true });
  for (const { name } of allArtifacts) await rm(path.join(seedRoot, `${name}.tgz`));
  await rm(path.join(storeSource, "v11", "projects"), { recursive: true, force: true });

  await git(root, ["init", "--quiet"]);
  await git(root, ["config", "user.name", "Visp Test"]);
  await git(root, ["config", "user.email", "visp-test@example.invalid"]);
  await mkdir(path.join(root, "bin"));
  const optionalDependencies = Object.fromEntries(definitions.map(({ name }) => [name, "1.0.0"]));
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({
    name: "prepared-optional-toy",
    version: "1.0.0",
    private: true,
    type: "module",
    packageManager: "pnpm@11.3.0",
    bin: { "prepared-optional-toy": "bin/prepared-optional-toy.mjs" },
    scripts: { prepack: "optional-toy-builder" },
    devDependencies: { "visp-optional-toy-builder": "1.0.0" },
    optionalDependencies,
  }, null, 2)}\n`);
  await writeFile(
    path.join(root, "bin", "prepared-optional-toy.mjs"),
    "#!/usr/bin/env node\nprocess.stdout.write('prepared optional\\n');\n",
    { mode: 0o755 },
  );
  const sourceDevImporter = "      visp-optional-toy-builder:\n        specifier: 1.0.0\n        version: 1.0.0";
  const sourceOptionalImporter = definitions
    .map(({ name }) => `      ${name}:\n        specifier: 1.0.0\n        version: 1.0.0`)
    .join("\n");
  const sourcePackages = allArtifacts
    .map(({ name, artifact, fields }) => {
      const metadata = Object.entries(fields)
        .map(([key, value]) => `    ${key}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`)
        .join("\n");
      return `  ${name}@1.0.0:\n    resolution: {integrity: ${artifact.integrity}}${metadata ? `\n${metadata}` : ""}`;
    })
    .join("\n\n");
  const sourceSnapshots = allArtifacts
    .map(({ name }) => name === "visp-optional-toy-builder"
      ? `  ${name}@1.0.0: {}`
      : `  ${name}@1.0.0:\n    optional: true`)
    .join("\n\n");
  await writeFile(path.join(root, "pnpm-lock.yaml"), `lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .:\n    devDependencies:\n${sourceDevImporter}\n    optionalDependencies:\n${sourceOptionalImporter}\n\npackages:\n\n${sourcePackages}\n\nsnapshots:\n\n${sourceSnapshots}\n`);
  await git(root, ["add", "package.json", "pnpm-lock.yaml", "bin"]);
  await git(root, ["commit", "--quiet", "-m", "optional prepared toy package"]);
  const { stdout: commit } = await git(root, ["rev-parse", "HEAD"]);
  const { stdout: tree } = await git(root, ["show", "-s", "--format=%T", "HEAD"]);
  return {
    root,
    storeSource,
    commit: commit.trim(),
    tree: tree.trim(),
    skippedNames: definitions.filter(({ fields }) => Object.keys(fields).length > 0).map(({ name }) => name).sort(),
  };
}

async function makePreparedAliasToyPackage(
  t,
  {
    aliasSpec = "npm:strip-ansi@6.0.1",
    logicalName = "strip-ansi-cjs",
    targetName = "strip-ansi",
    version = "6.0.1",
  } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "visp alias prepared source "));
  const seedRoot = await mkdtemp(path.join(tmpdir(), "visp alias pnpm seed "));
  const storeSource = path.join(seedRoot, "caller-store");
  const seedConsumer = path.join(seedRoot, "consumer");
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(seedRoot, { recursive: true, force: true }));

  const target = await makeRegistryArtifact(t, targetName, version, null, null);
  await mkdir(seedConsumer);
  const seedTarball = path.join(seedRoot, "artifact.tgz");
  await writeFile(seedTarball, await readFile(target.tarball));
  await writeFile(path.join(seedConsumer, "package.json"), `${JSON.stringify({
    name: "pnpm-alias-offline-store-seed",
    version: "1.0.0",
    private: true,
    dependencies: { [targetName]: version },
  }, null, 2)}\n`);
  await writeFile(path.join(seedConsumer, "pnpm-lock.yaml"), `lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .:\n    dependencies:\n      ${targetName}:\n        specifier: ${version}\n        version: ${version}\n\npackages:\n\n  ${targetName}@${version}:\n    resolution: {integrity: ${target.integrity}, tarball: file:../artifact.tgz}\n\nsnapshots:\n\n  ${targetName}@${version}: {}\n`);
  await execFileAsync("pnpm", [
    "install",
    "--offline",
    "--frozen-lockfile",
    "--trust-lockfile",
    "--ignore-scripts",
    "--package-import-method",
    "copy",
    "--store-dir",
    storeSource,
    "--virtual-store-dir",
    path.join(seedConsumer, "node_modules", ".pnpm"),
  ], {
    cwd: seedConsumer,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  await rm(path.join(seedConsumer, "node_modules"), { recursive: true, force: true });
  await rm(seedTarball);
  await rm(path.join(storeSource, "v11", "projects"), { recursive: true, force: true });

  await git(root, ["init", "--quiet"]);
  await git(root, ["config", "user.name", "Visp Test"]);
  await git(root, ["config", "user.email", "visp-test@example.invalid"]);
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({
    name: "prepared-alias-toy",
    version: "1.0.0",
    private: true,
    packageManager: "pnpm@11.3.0",
    devDependencies: { [logicalName]: aliasSpec },
  }, null, 2)}\n`);
  await writeFile(path.join(root, "pnpm-lock.yaml"), `lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .:\n    devDependencies:\n      ${logicalName}:\n        specifier: ${aliasSpec}\n        version: ${targetName}@${version}\n\npackages:\n\n  ${targetName}@${version}:\n    resolution: {integrity: ${target.integrity}}\n\nsnapshots:\n\n  ${targetName}@${version}: {}\n`);
  await git(root, ["add", "package.json", "pnpm-lock.yaml"]);
  await git(root, ["commit", "--quiet", "-m", "prepared alias toy package"]);
  const { stdout: commit } = await git(root, ["rev-parse", "HEAD"]);
  const { stdout: tree } = await git(root, ["show", "-s", "--format=%T", "HEAD"]);
  return {
    aliasSpec,
    commit: commit.trim(),
    logicalName,
    root,
    storeSource,
    targetName,
    tree: tree.trim(),
    version,
  };
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

async function makePnpmScenarioManager(t, scenario) {
  const root = await mkdtemp(path.join(tmpdir(), "visp pnpm scenario "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = path.join(root, "pnpm-scenario.mjs");
  const realPnpm = await pathExecutable("pnpm");
  await writeFile(executable, `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const scenario = ${JSON.stringify(scenario)};
const args = process.argv.slice(2);
const noOptional = args.includes("--no-optional");
const cachePath = (suffix) => path.join(process.cwd(), "..", \`\${path.basename(process.cwd())}-\${suffix}.json\`);
const spawnPnpm = (pnpmArgs) => spawnSync(${JSON.stringify(realPnpm)}, pnpmArgs, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
const result = args[0] === "list"
  ? {
      status: 0,
      stderr: "",
      stdout: readFileSync(
        cachePath(scenario === "full_no_optional_contradiction" ? "full" : noOptional ? "no-optional" : "full"),
        "utf8",
      ),
    }
  : spawnPnpm(args);
if (result.status !== 0) {
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exit(result.status ?? 1);
}

const moduleState = path.join(process.cwd(), "node_modules", ".modules.yaml");
const identity = "visp-toy-builder-offline@1.0.0";
const putSkipped = (values) => {
  const source = readFileSync(moduleState, "utf8");
  const start = source.indexOf("\\nskipped:");
  const end = source.indexOf("\\nstoreDir:", start);
  if (start < 0 || end < 0) throw new Error("unexpected pnpm skipped fixture");
  writeFileSync(
    moduleState,
    \`\${source.slice(0, start)}\\nskipped:\\n\${values.map((value) => \`  - \${value}\`).join("\\n")}\${source.slice(end)}\`,
  );
};
if (args[0] === "install") {
  const full = spawnPnpm(["list", "--depth", "Infinity", "--json"]);
  const noOptionalTree = spawnPnpm(["list", "--depth", "Infinity", "--json", "--no-optional"]);
  if (full.status !== 0 || noOptionalTree.status !== 0) throw new Error("could not cache pnpm tree fixtures");
  writeFileSync(cachePath("full"), full.stdout);
  writeFileSync(cachePath("no-optional"), noOptionalTree.stdout);
  if (scenario === "required_missing_skipped" || scenario === "present_skipped") putSkipped([identity]);
  if (scenario === "duplicate_skipped") putSkipped([identity, identity]);
  if (scenario === "malformed_modules") writeFileSync(moduleState, "skipped: [unterminated\\n");
  if (scenario === "wrong_manager") {
    const source = readFileSync(moduleState, "utf8");
    const updated = source.replace(/^packageManager:.*$/mu, "packageManager: pnpm@11.2.0");
    if (updated === source) throw new Error("unexpected pnpm package-manager fixture");
    writeFileSync(moduleState, updated);
  }
  if (scenario === "wrong_store") {
    const source = readFileSync(moduleState, "utf8");
    const updated = source.replace(/^storeDir:.*$/mu, "storeDir: /tmp/visp-foreign-pnpm-store");
    if (updated === source) throw new Error("unexpected pnpm store fixture");
    writeFileSync(moduleState, updated);
  }
  if (scenario === "escaping_nominal_path") {
    const escape = path.join(process.cwd(), "..", "pnpm-nominal-escape");
    try { unlinkSync(escape); } catch (error) { if (error.code !== "ENOENT") throw error; }
    symlinkSync(path.join(process.cwd(), "node_modules", "visp-toy-builder-offline"), escape, "dir");
  }
  if (scenario === "required_child_below_optional") {
    const manifestPath = path.join(process.cwd(), "node_modules", "visp-toy-builder-offline", "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.dependencies = { "visp-required-child": "1.0.0" };
    writeFileSync(manifestPath, \`\${JSON.stringify(manifest, null, 2)}\\n\`);
  }
  if (scenario.startsWith("ordinary_spec:") || [
    "present_peer_edge",
    "optional_peer_edge",
    "malformed_optional_peer_meta",
    "undeclared_edge",
    "ambiguous_peer_edge",
    "peer_identity_mismatch",
  ].includes(scenario)) {
    const rootManifestPath = path.join(process.cwd(), "package.json");
    const rootManifest = JSON.parse(readFileSync(rootManifestPath, "utf8"));
    if (scenario.startsWith("ordinary_spec:")) {
      rootManifest.devDependencies[identity.slice(0, identity.lastIndexOf("@"))] = scenario.slice("ordinary_spec:".length);
    }
    if (["present_peer_edge", "optional_peer_edge", "malformed_optional_peer_meta", "peer_identity_mismatch"].includes(scenario)) {
      delete rootManifest.devDependencies["visp-toy-builder-offline"];
      rootManifest.peerDependencies = { "visp-toy-builder-offline": "~1.0.0" };
    }
    if (scenario === "optional_peer_edge") {
      rootManifest.peerDependenciesMeta = { "visp-toy-builder-offline": { optional: true } };
    }
    if (scenario === "malformed_optional_peer_meta") {
      rootManifest.peerDependenciesMeta = { "visp-toy-builder-offline": { optional: "yes" } };
    }
    if (scenario === "undeclared_edge") delete rootManifest.devDependencies["visp-toy-builder-offline"];
    if (scenario === "ambiguous_peer_edge") {
      rootManifest.peerDependencies = { "visp-toy-builder-offline": ">=1" };
    }
    writeFileSync(rootManifestPath, \`\${JSON.stringify(rootManifest, null, 2)}\\n\`);
  }
}

if (args[0] === "list") {
  const tree = JSON.parse(result.stdout);
  const root = Array.isArray(tree) ? tree[0] : tree;
  const groups = [root.dependencies, root.devDependencies, root.optionalDependencies].filter(Boolean);
  if (scenario === "optional_peer_edge" && noOptional) {
    for (const group of groups) delete group["visp-toy-builder-offline"];
  }
  const builder = groups.map((group) => group["visp-toy-builder-offline"]).find(Boolean);
  if (builder) {
    if (scenario === "required_missing_skipped" || scenario === "optional_missing_not_skipped") {
      builder.path = path.join(process.cwd(), "node_modules", "visp-missing-builder");
    }
    if (scenario === "escaping_nominal_path") {
      builder.path = path.join(process.cwd(), "..", "pnpm-nominal-escape");
    }
    if (scenario === "identity_mismatch") builder.version = "9.9.9";
    if (scenario === "peer_identity_mismatch") builder.from = "visp-peer-impostor";
    if (scenario === "required_child_below_optional") {
      builder.dependencies = {
        "visp-required-child": {
          path: path.join(process.cwd(), "node_modules", "visp-toy-builder-offline", "node_modules", "visp-required-child"),
          version: "1.0.0",
        },
      };
    }
  }
  process.stdout.write(JSON.stringify(tree));
} else {
  process.stdout.write(result.stdout ?? "");
}
process.stderr.write(result.stderr ?? "");
`, { mode: 0o755 });
  return executable;
}

async function makeAliasScenarioManager(t, scenario, alias) {
  const root = await mkdtemp(path.join(tmpdir(), "visp pnpm alias scenario "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = path.join(root, "pnpm-alias-scenario.mjs");
  const realPnpm = await pathExecutable("pnpm");
  await writeFile(executable, `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const scenario = ${JSON.stringify(scenario)};
const logicalName = ${JSON.stringify(alias.logicalName)};
const targetName = ${JSON.stringify(alias.targetName)};
const args = process.argv.slice(2);
const noOptional = args.includes("--no-optional");
const cachePath = (suffix) => path.join(process.cwd(), "..", \`\${path.basename(process.cwd())}-alias-\${suffix}.json\`);
const spawnPnpm = (pnpmArgs) => spawnSync(${JSON.stringify(realPnpm)}, pnpmArgs, {
  cwd: process.cwd(),
  env: process.env,
  encoding: "utf8",
  maxBuffer: 2 * 1024 * 1024,
});
const result = args[0] === "list"
  ? {
      status: 0,
      stderr: "",
      stdout: readFileSync(cachePath(noOptional ? "no-optional" : "full"), "utf8"),
    }
  : spawnPnpm(args);
if (result.status !== 0) {
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exit(result.status ?? 1);
}

if (args[0] === "install") {
  const full = spawnPnpm(["list", "--depth", "Infinity", "--json"]);
  const noOptionalTree = spawnPnpm(["list", "--depth", "Infinity", "--json", "--no-optional"]);
  if (full.status !== 0 || noOptionalTree.status !== 0) throw new Error("could not cache pnpm alias trees");
  writeFileSync(cachePath("full"), full.stdout);
  writeFileSync(cachePath("no-optional"), noOptionalTree.stdout);

  const rootManifestPath = path.join(process.cwd(), "package.json");
  const rootManifest = JSON.parse(readFileSync(rootManifestPath, "utf8"));
  if (scenario === "undeclared_alias") delete rootManifest.devDependencies[logicalName];
  if (scenario === "unsupported_alias_spec") rootManifest.devDependencies[logicalName] = \`npm:\${targetName}@~6.0.0\`;
  if (scenario === "malformed_alias_spec") rootManifest.devDependencies[logicalName] = \`npm:\${targetName}\`;
  if (scenario === "out_of_range_alias") rootManifest.devDependencies[logicalName] = \`npm:\${targetName}@^7.0.0\`;
  writeFileSync(rootManifestPath, \`\${JSON.stringify(rootManifest, null, 2)}\\n\`);

  if (scenario === "manifest_mismatch") {
    const targetManifestPath = path.join(process.cwd(), "node_modules", logicalName, "package.json");
    const targetManifest = JSON.parse(readFileSync(targetManifestPath, "utf8"));
    targetManifest.name = \`\${targetName}-impostor\`;
    writeFileSync(targetManifestPath, \`\${JSON.stringify(targetManifest, null, 2)}\\n\`);
  }
}

if (args[0] === "list") {
  const tree = JSON.parse(result.stdout);
  const treeRoot = Array.isArray(tree) ? tree[0] : tree;
  const groups = [treeRoot.dependencies, treeRoot.devDependencies, treeRoot.optionalDependencies].filter(Boolean);
  const dependency = groups.map((group) => group[logicalName]).find(Boolean);
  if (!dependency) throw new Error("expected pnpm alias node is unavailable");
  if (scenario === "target_mismatch") dependency.from = \`\${targetName}-other\`;
  process.stdout.write(JSON.stringify(tree));
} else {
  process.stdout.write(result.stdout ?? "");
}
process.stderr.write(result.stderr ?? "");
`, { mode: 0o755 });
  return executable;
}

test("validates a full commit and snapshots only committed content without mutating source", async (t) => {
  const toy = await makeToyPackage(t);
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
  const toy = await makeToyPackage(t);
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

test("process runner records success, failure, spawn error, timeout, and bounded raw output", async () => {
  const success = await runProcess(process.execPath, ["-e", "process.stdout.write('ok'); process.stderr.write('note')"]);
  assert.equal(success.exitCode, 0);
  assert.equal(success.signal, null);
  assert.equal(success.stdout.text, "ok");
  assert.equal(success.stderr.text, "note");
  assert.equal(success.stdout.sha256, sha256Hex("ok"));

  const standardInput = await runProcess(
    process.execPath,
    ["-e", "process.stdin.pipe(process.stdout)"],
    { stdin: "newline-delimited request\n" },
  );
  assert.equal(standardInput.exitCode, 0);
  assert.equal(standardInput.stdout.text, "newline-delimited request\n");

  const nonzero = await runProcess(process.execPath, ["-e", "process.stderr.write('bad'); process.exit(7)"]);
  assert.equal(nonzero.exitCode, 7);
  assert.equal(nonzero.stderr.text, "bad");

  const missing = await runProcess(path.join(tmpdir(), "definitely missing visp executable"), []);
  assert.equal(missing.exitCode, null);
  assert.equal(missing.spawnError.code, "ENOENT");
  assert.equal(missing.spawnError.message, undefined);
  assert.match(missing.spawnError.messageSha256, /^[0-9a-f]{64}$/);

  const timedOut = await runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 50 });
  assert.equal(timedOut.timedOut, true);
  assert.equal(timedOut.exitCode, null);
  assert.ok(timedOut.signal);

  const bounded = await runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(200000))"], {
    maxOutputBytes: 1024,
  });
  assert.equal(Buffer.byteLength(bounded.stdout.text), 1024);
  assert.equal(bounded.stdout.bytes, 200000);
  assert.equal(bounded.stdout.truncated, true);
  assert.equal(bounded.stdout.sha256, sha256Hex("x".repeat(200000)));
});

test("process timeout terminates descendants that retain stdio within a bounded wall time", async (t) => {
  const markerRoot = await mkdtemp(path.join(tmpdir(), "visp-timeout-marker-"));
  t.after(() => rm(markerRoot, { recursive: true, force: true }));
  const marker = path.join(markerRoot, "descendant-survived");
  const descendant = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'leaked'), 700); setTimeout(() => process.exit(0), 1500);`;
  const parent = `const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'inherit', 'inherit'] }); process.stdout.write(String(child.pid) + '\\n'); setInterval(() => {}, 1000);`;
  const started = performance.now();
  const result = await runProcess(process.execPath, ["-e", parent], { timeoutMs: 50 });
  const elapsedMs = performance.now() - started;
  assert.equal(result.timedOut, true);
  assert.ok(elapsedMs < 600, `timeout returned after ${elapsedMs}ms`);
  await new Promise((resolve) => setTimeout(resolve, 800));
  await assert.rejects(stat(marker), { code: "ENOENT" });
});

test("pack preparation is pinned, offline, ambient-config resistant, and repeated independently", async (t) => {
  const toy = await makePreparedToyPackage(t);
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

test("pinned pnpm records deterministic optional absences from a real offline toy graph", async (t) => {
  const toy = await makeOptionalPreparedToyPackage(t);
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
  const optionalToy = await makePreparedToyPackage(t, { dependencyGroup: "optionalDependencies" });
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
  const cases = [
    { name: "undeclared edge", scenario: "undeclared_edge" },
    { name: "ambiguous peer edge", scenario: "ambiguous_peer_edge" },
    { name: "peer target mismatch", scenario: "peer_identity_mismatch" },
    { name: "malformed optional peer metadata", scenario: "malformed_optional_peer_meta" },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async (subtest) => {
      const manager = await makePnpmScenarioManager(subtest, fixture.scenario);
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

test("independent snapshots pack identically and expose deterministic package inventory", async (t) => {
  const toy = await makeToyPackage(t);
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

test("offline local-tarball install disables scripts and confines installed bins", async (t) => {
  const toy = await makeToyPackage(t);
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

test("caller npm cache hydrates only a closed reachable registry lock graph offline", async (t) => {
  const toy = await makeToyPackage(t, "cache-hydration-package");
  const leafOne = await makeRegistryArtifact(t, "@visp/graph-leaf", "1.4.0", null, null);
  const leafTwo = await makeRegistryArtifact(t, "@visp/graph-leaf", "2.3.0", null, null);
  const child = await makeRegistryArtifact(t, "visp-graph-child", "0.2.9", null, null);
  const zeroPatch = await makeRegistryArtifact(t, "visp-zero-patch", "0.0.3", null, null);
  const parent = await makeRegistryArtifact(t, "visp-graph-parent", "1.2.3", null, null, {
    dependencies: { "@visp/graph-leaf": "^2.0.0", "visp-graph-child": "^0.2.3", "visp-zero-patch": "^0.0.3" },
  });
  const commander = await makeRegistryArtifact(t, "commander", "12.1.0", null, null);
  const zod = await makeRegistryArtifact(t, "zod", "3.25.76", null, null);
  const exact = await makeRegistryArtifact(t, "visp-graph-exact", "4.5.6", null, null);
  const extraneous = await makeRegistryArtifact(t, "visp-graph-extraneous", "1.0.0", null, null);
  const impostor = await makeRegistryArtifact(t, "visp-graph-impostor", "0.2.9", null, null);
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

test("owned-root cleanup rejects foreign paths and supports explicit keep", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "visp-owned-parent-"));
  try {
    const kept = await createOwnedRoot({ baseDirectory: parent });
    assert.equal((await cleanupOwnedRoot({ root: kept.root, keep: true })).kept, true);
    assert.ok(await stat(kept.root));
    assert.equal((await cleanupOwnedRoot({ root: kept.root })).kept, false);
    await assert.rejects(stat(kept.root), { code: "ENOENT" });

    const foreign = path.join(parent, "foreign");
    await mkdir(foreign);
    await assert.rejects(cleanupOwnedRoot({ root: foreign }), /not owned/i);
    assert.ok(await stat(foreign));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("complete laboratory output is canonical, stable, separated, and non-authoritative", async (t) => {
  const toy = await makeToyPackage(t);
  const expectations = {
    package: { name: "toy-package", version: "1.2.3", bins: ["toy-command"] },
    execution: {
      bin: "toy-command",
      args: ["stable"],
      exitCode: 0,
      stdout: '{"argv":["stable"],"cwd":"isolated"}\n',
    },
  };
  const input = { repositoryRoot: toy.root, commit: toy.commit, expectations };
  const first = await runCompatibilityLab(input);
  const second = await runCompatibilityLab(input);

  assert.equal(canonicalStringify(first), canonicalStringify(second));
  assert.deepEqual(first.expectations, expectations);
  assert.equal(first.observations.source.commit, toy.commit);
  assert.equal(first.observations.source.tree, toy.tree);
  assert.ok(first.assertions.every(({ passed }) => passed));
  assert.deepEqual(first.summary, { assertions_passed: true, failed: 0, passed: first.assertions.length });

  const rendered = canonicalStringify(first);
  assert.doesNotMatch(rendered, /visp-compatibility-lab-|duration|timestamp/i);
  assert.doesNotMatch(rendered, /verdict|permission|assurance|completion|pr[_ -]?readiness/i);
  assert.equal(rendered.endsWith("\n"), true);
  assert.equal(rendered, canonicalStringify(JSON.parse(rendered)));
});

test("execution output fails closed when full raw bytes contain an owned random path", async (t) => {
  const toy = await makeToyPackage(t, "path-emitting-package");
  await writeFile(
    path.join(toy.root, "bin", "toy-command.mjs"),
    "#!/usr/bin/env node\nprocess.stdout.write('x'.repeat(1100000)); process.stdout.write(process.cwd() + '\\n');\n",
    { mode: 0o755 },
  );
  await git(toy.root, ["add", "bin/toy-command.mjs"]);
  await git(toy.root, ["commit", "--quiet", "-m", "emit runtime path"]);
  const { stdout: commitOutput } = await git(toy.root, ["rev-parse", "HEAD"]);
  const input = {
    repositoryRoot: toy.root,
    commit: commitOutput.trim(),
    expectations: { execution: { bin: "toy-command", args: [], exitCode: 0 } },
  };
  const errors = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await runCompatibilityLab(input);
      assert.fail("owned path output must fail closed");
    } catch (error) {
      errors.push({ code: error.code, message: error.message });
    }
  }
  assert.deepEqual(errors[0], errors[1]);
  assert.deepEqual(errors[0], {
    code: "UNSTABLE_EXECUTION_OUTPUT",
    message: "Execution output contains a laboratory-owned temporary path",
  });
  assert.doesNotMatch(canonicalStringify(errors[0]), /visp-compatibility-lab-/i);
});

test("complete laboratory fails stably when an installed bin has a broken interpreter", async (t) => {
  const toy = await makeToyPackage(t, "broken-bin-package");
  const missingInterpreter = path.join(toy.root, "missing-interpreter");
  await writeFile(
    path.join(toy.root, "bin", "toy-command.mjs"),
    `#!${missingInterpreter}\nprocess.stdout.write('must not run\\n');\n`,
    { mode: 0o755 },
  );
  await git(toy.root, ["add", "bin/toy-command.mjs"]);
  await git(toy.root, ["commit", "--quiet", "-m", "broken installed bin"]);
  const { stdout: commitOutput } = await git(toy.root, ["rev-parse", "HEAD"]);
  const input = {
    repositoryRoot: toy.root,
    commit: commitOutput.trim(),
    expectations: { execution: { bin: "toy-command", args: [], exitCode: 0 } },
  };
  const failures = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await runCompatibilityLab(input);
      assert.fail("broken interpreter must fail closed");
    } catch (error) {
      failures.push({ code: error.code, message: error.message });
    }
  }
  assert.deepEqual(failures[0], failures[1]);
  assert.deepEqual(failures[0], {
    code: "EXECUTION_SPAWN_FAILED",
    message: "Installed binary could not be executed",
  });
  assert.doesNotMatch(canonicalStringify(failures[0]), /visp-compatibility-lab-|missing-interpreter/i);
});

test("closed input validation rejects unknown keys and malformed expectations", async (t) => {
  const toy = await makeToyPackage(t);
  await assert.rejects(
    runCompatibilityLab({ repositoryRoot: toy.root, commit: toy.commit, expectations: {}, extra: true }),
    /unknown input key/i,
  );
  await assert.rejects(
    runCompatibilityLab({ repositoryRoot: toy.root, commit: toy.commit, expectations: { package: { bins: "toy-command" } } }),
    /expectations\.package\.bins/i,
  );
  await assert.rejects(
    runCompatibilityLab({ repositoryRoot: toy.root, commit: toy.commit.slice(0, 8), expectations: {} }),
    /full 40-character/i,
  );
});

test("CLI runs the complete toy-package laboratory and emits one canonical document", async (t) => {
  const toy = await makeToyPackage(t);
  const cli = fileURLToPath(new URL("../scripts/run-compatibility-lab.mjs", import.meta.url));
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    cli,
    "--repository",
    toy.root,
    "--commit",
    toy.commit,
    "--expect-package-name",
    "toy-package",
    "--expect-package-version",
    "1.2.3",
    "--expect-bin",
    "toy-command",
    "--run-bin",
    "toy-command",
    "--bin-arg",
    "cli proof ;$()",
    "--expect-stdout",
    '{"argv":["cli proof ;$()"],"cwd":"isolated"}\n',
    "--keep",
  ], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  const retainedMatch = /^compatibility-lab: retained root (.+)\n$/u.exec(stderr);
  assert.ok(retainedMatch);
  const retainedRoot = retainedMatch[1];
  assert.ok(await stat(retainedRoot));
  const document = JSON.parse(stdout);
  assert.equal(document.summary.assertions_passed, true);
  assert.equal(stdout, canonicalStringify(document));
  assert.doesNotMatch(stdout, new RegExp(toy.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  assert.doesNotMatch(stdout, new RegExp(retainedRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  await cleanupOwnedRoot({ root: retainedRoot });
});

test("CLI reports and immediately cleans exact kept roots for concurrent failures", async (t) => {
  const toy = await makeToyPackage(t);
  const cli = fileURLToPath(new URL("../scripts/run-compatibility-lab.mjs", import.meta.url));
  const invokeFailure = async () => {
    try {
      await execFileAsync(process.execPath, [
        cli,
        "--repository",
        toy.root,
        "--commit",
        toy.commit,
        "--offline-cache",
        path.join(toy.root, "missing-cache"),
        "--keep",
      ], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
      assert.fail("CLI failure fixture must fail");
    } catch (error) {
      const retainedMatch = /^compatibility-lab: .+\ncompatibility-lab: retained root (.+)\n$/u.exec(error.stderr);
      assert.ok(retainedMatch);
      const retainedRoot = retainedMatch[1];
      try {
        assert.ok(await stat(retainedRoot));
        const document = JSON.parse(error.stdout);
        assert.equal(error.stdout, canonicalStringify(document));
        assert.doesNotMatch(error.stdout, new RegExp(retainedRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      } finally {
        await cleanupOwnedRoot({ root: retainedRoot });
      }
      await assert.rejects(stat(retainedRoot), { code: "ENOENT" });
      return retainedRoot;
    }
  };
  const roots = await Promise.all([invokeFailure(), invokeFailure()]);
  assert.equal(new Set(roots).size, 2);
});
