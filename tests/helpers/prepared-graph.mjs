/**
 * Toy packages with a real pnpm-prepared dependency graph, including the
 * optional-absence and npm-alias shapes.
 *
 * These build genuine offline pnpm stores rather than hand-written lockfiles.
 * A hand-written fixture would encode what we believe pnpm emits, and the
 * normaliser under test exists precisely because that belief was wrong once.
 */
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import {
  runProcess,
  snapshotFidelityAvailable,
} from "../../src/toolchain/index.mjs";
import {
  execFileAsync,
  git,
  makeRegistryArtifact,
} from "./toy-package.mjs";

async function makePreparedToyPackage(t, { dependencyGroup = "devDependencies" } = {}) {
  if (!(await pnpmAvailable())) {
    t.skip("pnpm is not installed on this matrix leg");
    return null;
  }

  // Reached only where pnpm exists, which today excludes Windows because
  // `pnpmAvailable` spawns a bare `pnpm`. That is the wrong thing to depend on:
  // this factory builds a registry artifact, and that needs mode-faithful
  // snapshots regardless of which package manager is installed. Without this
  // the shield is incidental, and fixing pnpm detection would turn a clean skip
  // into `Cannot read properties of null`.
  if (!snapshotFidelityAvailable()) {
    t.skip("mode-faithful snapshots are not reproducible on this platform");
    return null;
  }

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

/**
 * The optional-dependency absences this fixture pins are Linux-specific: the
 * optional packages that resolve on one platform differ from another, so the
 * recorded set is only meaningful on the lane it was calibrated for.
 *
 * It used to assert the platform, which turned "not applicable here" into a
 * failure and made the whole suite red on macOS and Windows. That hid every
 * other cross-platform result, which is the opposite of what a platform matrix
 * is for. It skips instead, and returns null so the caller stops.
 */
/**
 * Whether pnpm is on PATH. The CI matrix runs every leg under both managers, and
 * the pnpm-specific fixtures cannot run on the npm legs — pnpm is only installed
 * where the matrix asks for it. Absent is "not applicable", not a failure.
 */
async function pnpmAvailable() {
  const result = await runProcess("pnpm", ["--version"], {}).catch(() => null);

  return result !== null && result.exitCode === 0;
}

async function makeOptionalPreparedToyPackage(t) {
  if (!(await pnpmAvailable())) {
    t.skip("pnpm is not installed on this matrix leg");
    return null;
  }

  if (process.platform !== "linux") {
    t.skip("the pinned-pnpm optional fixture is calibrated for the Linux compatibility lane");
    return null;
  }
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
  if (!snapshotFidelityAvailable()) {
    t.skip("mode-faithful snapshots are not reproducible on this platform");
    return null;
  }

  const root = await mkdtemp(path.join(tmpdir(), "visp alias prepared source "));
  const seedRoot = await mkdtemp(path.join(tmpdir(), "visp alias pnpm seed "));
  const storeSource = path.join(seedRoot, "caller-store");
  const seedConsumer = path.join(seedRoot, "consumer");
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(seedRoot, { recursive: true, force: true }));

  const target = await makeRegistryArtifact(t, targetName, version, null, null);

  if (target === null) return;
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

export {
  makeOptionalPreparedToyPackage,
  makePreparedAliasToyPackage,
  makePreparedToyPackage,
  pnpmAvailable,
};
