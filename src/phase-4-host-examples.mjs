import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import {
  access,
  cp,
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path, { delimiter } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import {
  canonicalStringify,
  cleanupOwnedRoot,
  createOwnedRoot,
  inspectInstalledBins,
  installLocalTarball,
  runProcess,
  sha256Hex,
} from "./compatibility-lab.mjs";

const HOSTS = ["claude-code", "codex", "copilot", "generic", "opencode"];
const execFileAsync = promisify(execFile);
const SUPPORT = new Set(["native", "surface_limited", "manual", "unsupported"]);
const MECHANICAL_FALLBACKS = new Set(["native_hooks", "git_and_ci"]);
const ORCHESTRATION_FALLBACKS = new Set(["native_subagents", "sequential"]);
const MODEL_FALLBACKS = new Set(["automatic", "host_controlled", "advisory"]);
const HASH = /^[a-f0-9]{64}$/u;
const SUPPORT_KEYS = [
  "repoGuidance",
  "skills",
  "commands",
  "hooks",
  "mcp",
  "subagents",
  "verifierRole",
  "challengerRole",
  "automaticModelSelection",
];
const REQUIRED_DESTINATIONS = {
  "claude-code": [
    ".claude/agents/coordinator.md",
    ".claude/skills/visp-hyper/SKILL.md",
  ],
  codex: [".agents/skills/visp-hyper/SKILL.md"],
  copilot: [".github/instructions/visp-hyper.instructions.md"],
  generic: ["visp-hyper-instructions.md"],
  opencode: [".agents/skills/visp-hyper/SKILL.md"],
};
const HOST_EXECUTABLES = {
  "claude-code": "claude",
  codex: "codex",
  copilot: "copilot",
  opencode: "opencode",
};
const TOP_LEVEL_MANIFEST_KEYS = new Set([
  "manifestVersion",
  "host",
  "validatedAgainst",
  "supports",
  "fallbacks",
  "assets",
]);
const VALIDATED_AGAINST_KEYS = new Set([
  "asOf",
  "hostVersion",
  "surface",
  "documentation",
]);
const FALLBACK_KEYS = new Set([
  "mechanicalEnforcement",
  "orchestration",
  "modelSelection",
]);
const ASSET_KEYS = new Set(["templatePath", "destination"]);

export async function createPhase4HostExamplesReport({
  packageSha256,
  templatesRoot,
}) {
  if (!HASH.test(packageSha256)) {
    throw new TypeError("packageSha256 must be a SHA-256 hex digest");
  }
  const examples = [];
  for (const host of HOSTS) {
    const hostRoot = path.join(templatesRoot, host);
    const manifestText = await readFile(path.join(hostRoot, "capabilities.json"), "utf8");
    const manifest = JSON.parse(manifestText);
    validateManifest(manifest, host);
    const models = await readModelMap(hostRoot);
    const assets = [];
    for (const asset of manifest.assets) {
      const source = await readFile(path.join(hostRoot, asset.templatePath), "utf8");
      const rendered = renderModels(source, models);
      assets.push({
        destination: asset.destination,
        renderedSha256: sha256Hex(rendered),
        templatePath: asset.templatePath,
      });
      if (host === "copilot" && !rendered.startsWith('---\napplyTo: "**"\n---\n')) {
        throw new Error("Copilot instructions lack required applyTo frontmatter");
      }
    }
    const destinations = new Set(assets.map((asset) => asset.destination));
    for (const required of REQUIRED_DESTINATIONS[host]) {
      if (!destinations.has(required)) {
        throw new Error(`${host} packed example lacks native destination ${required}`);
      }
    }
    examples.push({
      assets,
      fallbacks: manifest.fallbacks,
      host,
      manifestSha256: sha256Hex(manifestText),
      surface: manifest.validatedAgainst.surface,
      supports: manifest.supports,
      validatedAsOf: manifest.validatedAgainst.asOf,
    });
  }
  return finalizeReport({
    examples,
    package: null,
    packageSha256,
    runtime: null,
    schemaVersion: "visp.phase-4-host-examples.v2",
    summary: {
      assetsVerified: examples.reduce((count, example) => count + example.assets.length, 0),
      hostsVerified: examples.length,
      mechanicalFallback: "git_and_ci",
      runtimeHostsVerified: 0,
      runtimeVerified: false,
    },
  });
}

export function verifyPhase4HostExamplesReport(report, { requireRuntime = false } = {}) {
  if (report?.schemaVersion !== "visp.phase-4-host-examples.v2"
    || !HASH.test(report.packageSha256 ?? "")
    || !HASH.test(report.reportSha256 ?? "")
    || !Array.isArray(report.examples)
    || report.examples.length !== HOSTS.length) {
    throw new Error("Phase 4 host examples report identity is invalid");
  }
  const unhashed = structuredClone(report);
  delete unhashed.reportSha256;
  if (sha256Hex(canonicalStringify(unhashed)) !== report.reportSha256) {
    throw new Error("Phase 4 host examples report hash does not match its content");
  }
  for (const [index, host] of HOSTS.entries()) {
    const example = report.examples[index];
    if (example?.host !== host
      || !HASH.test(example.manifestSha256 ?? "")
      || !nonEmptyString(example.surface)
      || !/^\d{4}-\d{2}-\d{2}$/u.test(example.validatedAsOf ?? "")
      || !Array.isArray(example.assets)
      || example.assets.length === 0
      || example.fallbacks?.mechanicalEnforcement !== "git_and_ci"
      || !ORCHESTRATION_FALLBACKS.has(example.fallbacks?.orchestration)
      || !MODEL_FALLBACKS.has(example.fallbacks?.modelSelection)
      || Object.keys(example.supports ?? {}).sort().join(",") !== [...SUPPORT_KEYS].sort().join(",")
      || Object.values(example.supports ?? {}).some((value) => !SUPPORT.has(value))) {
      throw new Error(`Phase 4 ${host} example is invalid`);
    }
    const destinations = new Set();
    for (const asset of example.assets) {
      if (!safeRelative(asset.destination)
        || !safeRelative(asset.templatePath)
        || !HASH.test(asset.renderedSha256 ?? "")
        || destinations.has(asset.destination)) {
        throw new Error(`Phase 4 ${host} example has invalid assets`);
      }
      destinations.add(asset.destination);
    }
    for (const required of REQUIRED_DESTINATIONS[host]) {
      if (!destinations.has(required)) {
        throw new Error(`Phase 4 ${host} native asset is missing`);
      }
    }
  }
  if (report.examples.find((entry) => entry.host === "generic")?.fallbacks?.orchestration !== "sequential"
    || report.examples.find((entry) => entry.host === "generic")?.fallbacks?.modelSelection !== "advisory"
    || report.summary?.hostsVerified !== 5
    || report.summary?.assetsVerified !== report.examples.reduce(
      (count, example) => count + example.assets.length,
      0,
    )
    || report.summary?.mechanicalFallback !== "git_and_ci") {
    throw new Error("Phase 4 fallback summary is invalid");
  }
  if (report.runtime === null) {
    if (requireRuntime
      || report.package !== null
      || report.summary?.runtimeVerified !== false
      || report.summary?.runtimeHostsVerified !== 0) {
      throw new Error("Phase 4 runtime verification is required or inconsistent");
    }
    return true;
  }
  verifyRuntime(report);
  return true;
}

export async function runPackedPhase4HostExamples({
  tarballPath,
  repositoryRoot,
  npmCommand = "npm",
  offlineCacheSource,
  keepOwnedRoot = false,
} = {}) {
  if (Boolean(tarballPath) === Boolean(repositoryRoot)) {
    throw new TypeError("Provide exactly one of tarballPath or repositoryRoot");
  }
  const owned = await createOwnedRoot();
  let failure;
  try {
    const packageInput = tarballPath
      ? await copyTarballIntoOwnedRoot(tarballPath, owned.root)
      : await packRepository(repositoryRoot, owned.root, npmCommand);
    const fixtureRoot = path.join(owned.root, "installed package");
    const install = repositoryRoot
      ? await installRepositoryPackageGraph({
        dependencyTarballs: await packRepositoryDependencies(repositoryRoot, owned.root, npmCommand),
        fixtureRoot,
        hyperTarball: packageInput,
        npmCommand,
      })
      : await installLocalTarball({
        tarballPath: packageInput,
        fixtureRoot,
        npmCommand,
        offlineCacheSource,
      });
    const packageRoot = path.join(fixtureRoot, "node_modules", "visp-hyper-agent");
    const packageManifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
    if (packageManifest.name !== "visp-hyper-agent"
      || typeof packageManifest.version !== "string"
      || packageManifest.bin?.["visp-hyper"] !== "dist/index.js") {
      throw new Error("Packed Phase 4 input is not a compatible visp-hyper-agent package");
    }
    const staticReport = await createPhase4HostExamplesReport({
      packageSha256: sha256Hex(await readFile(packageInput)),
      templatesRoot: path.join(packageRoot, "templates"),
    });
    const runtimeHosts = [];
    const gitExecutable = await findExecutable("git");
    if (!gitExecutable) throw new Error("Git is required for Phase 4 fallback verification");
    const runtimePath = path.dirname(gitExecutable);
    for (const executable of Object.values(HOST_EXECUTABLES)) {
      if (await executableExists(runtimePath, executable)) {
        throw new Error(`Cannot isolate the intentional missing-host fallback: ${executable} is beside Git`);
      }
    }
    const cliEntry = path.join(packageRoot, "dist", "index.js");
    await access(cliEntry, fsConstants.R_OK);
    const captureRunner = path.join(owned.root, "capture-hyper-output.mjs");
    await writeFile(captureRunner, hyperCaptureRunnerSource(), { flag: "wx", mode: 0o700 });
    for (const example of staticReport.examples) {
      runtimeHosts.push(await verifyHostRuntime({
        captureRunner,
        cliEntry,
        gitExecutable,
        example,
        ownedRoot: owned.root,
        runtimePath,
      }));
    }
    const bin = install.bins.find((entry) => entry.name === "visp-hyper");
    if (!bin) {
      throw new Error("Clean install did not expose the visp-hyper binary");
    }
    const report = finalizeReport({
      ...staticReport,
      package: {
        binSha256: bin.sha256,
        dependencyTreeSha256: install.dependencyTree.sha256,
        installCacheMode: install.cache.mode,
        lifecycleScriptsDisabled: install.lifecycleScriptsDisabled,
        name: packageManifest.name,
        offlineInstall: install.offline,
        version: packageManifest.version,
      },
      runtime: {
        hosts: runtimeHosts,
      },
      summary: {
        ...staticReport.summary,
        runtimeHostsVerified: runtimeHosts.length,
        runtimeVerified: true,
      },
    });
    verifyPhase4HostExamplesReport(report, { requireRuntime: true });
    if (keepOwnedRoot) {
      Object.defineProperty(report, "retainedRoot", { enumerable: false, value: owned.root });
    }
    return report;
  } catch (error) {
    failure = error;
    if (keepOwnedRoot) {
      Object.defineProperty(error, "retainedRoot", { enumerable: false, value: owned.root });
    }
    throw error;
  } finally {
    if (!keepOwnedRoot) {
      try {
        await cleanupOwnedRoot({ root: owned.root });
      } catch (cleanupError) {
        if (!failure) throw cleanupError;
      }
    }
  }
}

function validateManifest(manifest, host) {
  assertExactKeys(manifest, TOP_LEVEL_MANIFEST_KEYS, `${host} capability manifest`);
  assertExactKeys(manifest.validatedAgainst, VALIDATED_AGAINST_KEYS, `${host} validatedAgainst`);
  assertExactKeys(manifest.supports, new Set(SUPPORT_KEYS), `${host} supports`);
  assertExactKeys(manifest.fallbacks, FALLBACK_KEYS, `${host} fallbacks`);
  if (manifest.manifestVersion !== "1.0"
    || manifest.host !== host
    || !HOSTS.includes(manifest.host)
    || !/^\d{4}-\d{2}-\d{2}$/u.test(manifest.validatedAgainst.asOf ?? "")
    || !(manifest.validatedAgainst.hostVersion === null
      || nonEmptyString(manifest.validatedAgainst.hostVersion))
    || !nonEmptyString(manifest.validatedAgainst.surface)
    || !Array.isArray(manifest.validatedAgainst.documentation)
    || manifest.validatedAgainst.documentation.length === 0
    || manifest.validatedAgainst.documentation.some((url) => !isHttpUrl(url))
    || !Array.isArray(manifest.assets)
    || manifest.assets.length === 0
    || !MECHANICAL_FALLBACKS.has(manifest.fallbacks.mechanicalEnforcement)
    || !ORCHESTRATION_FALLBACKS.has(manifest.fallbacks.orchestration)
    || !MODEL_FALLBACKS.has(manifest.fallbacks.modelSelection)
    || SUPPORT_KEYS.some((key) => !SUPPORT.has(manifest.supports[key]))) {
    throw new Error(`${host} capability manifest is invalid`);
  }
  const destinations = new Set();
  for (const asset of manifest.assets) {
    assertExactKeys(asset, ASSET_KEYS, `${host} asset`);
    if (!safeRelative(asset.templatePath)
      || !safeRelative(asset.destination)
      || destinations.has(asset.destination)) {
      throw new Error(`${host} capability manifest contains an unsafe or duplicate asset`);
    }
    destinations.add(asset.destination);
  }
}

async function verifyHostRuntime({
  captureRunner,
  cliEntry,
  example,
  gitExecutable,
  ownedRoot,
  runtimePath,
}) {
  const projectPath = path.join(ownedRoot, "host projects", `${example.host} example`);
  await mkdir(projectPath, { recursive: true });
  const runtimeEnvironment = {
    CI: "true",
    LANG: "C",
    LC_ALL: "C",
    PATH: runtimePath,
    TZ: "UTC",
  };
  const init = await runHyper(captureRunner, cliEntry, projectPath, [
    "init",
    "--tool",
    example.host,
  ], runtimeEnvironment, "host init");
  if (!init.stdout.text.includes(`Installed ${example.host} assets:`)) {
    throw new Error(`${example.host} init did not report its installed assets`);
  }
  const configPath = path.join(projectPath, ".visp", "hyper", "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (config.skillMode !== "review") {
    throw new Error(`${example.host} init did not preserve the review-default skill mode`);
  }
  config.defaultTool = example.host;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  for (const asset of example.assets) {
    const installed = await readFile(path.join(projectPath, asset.destination), "utf8");
    if (sha256Hex(installed) !== asset.renderedSha256) {
      throw new Error(`${example.host} runtime asset differs from its packed template`);
    }
  }

  await execFileAsync(gitExecutable, ["init", "--quiet", projectPath], {
    encoding: "utf8",
    env: runtimeEnvironment,
    maxBuffer: 256 * 1024,
    timeout: 30_000,
  });
  await runHyper(captureRunner, cliEntry, projectPath, ["hooks", "git"], runtimeEnvironment, "Git hook install");
  await runHyper(captureRunner, cliEntry, projectPath, ["hooks", "ci"], runtimeEnvironment, "CI fallback install");
  const hookPath = path.join(projectPath, ".git", "hooks", "pre-commit");
  const hook = await readFile(hookPath, "utf8");
  if (!hook.includes("# visp-hyper-guard hook")
    || !hook.includes("visp-hyper guard --staged")
    || (process.platform !== "win32" && ((await stat(hookPath)).mode & 0o111) === 0)) {
    throw new Error(`${example.host} Git fallback hook is incomplete`);
  }
  const workflow = await readFile(
    path.join(projectPath, ".github", "workflows", "visp-hyper-gate.yml"),
    "utf8",
  );
  if (!workflow.includes("# visp-hyper-guard workflow")
    || !workflow.includes("visp-hyper guard --base")) {
    throw new Error(`${example.host} CI fallback workflow is incomplete`);
  }

  const doctorResult = await runHyper(
    captureRunner,
    cliEntry,
    projectPath,
    ["doctor", "--json"],
    runtimeEnvironment,
    "doctor",
  );
  let doctor;
  try {
    doctor = JSON.parse(doctorResult.stdout.text);
  } catch {
    throw new Error(`${example.host} doctor returned malformed JSON`);
  }
  const checks = Object.fromEntries(
    doctor.checks.map((check) => [check.id, { status: check.status, recovery: check.recovery ?? null }]),
  );
  for (const checkId of ["hyper-state", "hyper-config", "tool-assets", "git-hook", "memory", "mcp"]) {
    if (checks[checkId]?.status !== "pass") {
      throw new Error(`${example.host} doctor ${checkId} check did not pass`);
    }
  }
  if (checks["kit-artifacts"]?.status !== "warn") {
    throw new Error(`${example.host} doctor did not identify the Kit-less fallback`);
  }
  const selectedHost = checks["selected-host"];
  const hostFallback = example.host === "generic"
    ? selectedHost?.status === "pass"
    : selectedHost?.status === "warn"
      && selectedHost.recovery?.includes("sequential and Git/CI fallbacks");
  if (!hostFallback) {
    throw new Error(`${example.host} doctor did not validate its selected-host fallback`);
  }
  if (doctor.success !== true) {
    throw new Error(`${example.host} doctor reported a failed runtime`);
  }
  return {
    assets: "pass",
    ciFallback: "installed",
    configuredHost: example.host,
    doctor: "pass",
    gitFallback: "installed",
    hostBinary: example.host === "generic" ? "not_required" : "intentionally_absent",
    hostSelection: example.host === "generic" ? "manual" : "fallback",
    kitMode: "local_checked",
    mcp: "pass",
    skillMode: "review",
  };
}

let runtimeInvocation = 0;

async function runHyper(captureRunner, cliEntry, projectPath, args, env, label) {
  runtimeInvocation += 1;
  const capturePath = path.join(projectPath, `.visp-dev-runtime-${runtimeInvocation}.json`);
  const result = await runProcess(
    process.execPath,
    [captureRunner, capturePath, cliEntry, projectPath, ...args],
    { cwd: projectPath, env, maxOutputBytes: 2 * 1024 * 1024, timeoutMs: 30_000 },
  );
  let captured;
  try {
    captured = JSON.parse(await readFile(capturePath, "utf8"));
  } catch {
    captured = null;
  }
  if (result.spawnError || result.timedOut || result.exitCode !== 0
    || result.stdout.truncated || result.stderr.truncated
    || captured?.exitCode !== 0
    || !Array.isArray(captured?.stdout)
    || !Array.isArray(captured?.stderr)) {
    const error = new Error(`Packed visp-hyper ${label} failed`);
    error.code = "PACKED_HYPER_RUNTIME_FAILED";
    Object.defineProperty(error, "observation", { value: { captured, process: result } });
    throw error;
  }
  return {
    stderr: { text: captured.stderr.join("\n") },
    stdout: { text: captured.stdout.join("\n") },
  };
}

function hyperCaptureRunnerSource() {
  return `import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [, , capturePath, cliEntry, projectPath, ...args] = process.argv;
const stdout = [];
const stderr = [];
console.log = (...values) => stdout.push(values.map(String).join(" "));
console.warn = (...values) => stderr.push(values.map(String).join(" "));
console.error = (...values) => stderr.push(values.map(String).join(" "));
let failure = null;
try {
  process.argv = [process.execPath, cliEntry, "--project", projectPath, ...args];
  await import(pathToFileURL(cliEntry).href);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
}
writeFileSync(capturePath, JSON.stringify({
  exitCode: process.exitCode ?? 0,
  failure,
  stderr,
  stdout,
}));
`;
}

async function copyTarballIntoOwnedRoot(tarballPath, ownedRoot) {
  if (!nonEmptyString(tarballPath)) throw new TypeError("tarballPath must be a non-empty path");
  const source = await realpath(tarballPath);
  if (!(await stat(source)).isFile()) throw new TypeError("tarballPath must identify a file");
  const destination = path.join(ownedRoot, "visp-hyper-agent-input.tgz");
  await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
  return destination;
}

async function packRepository(repositoryRoot, ownedRoot, npmCommand) {
  if (!nonEmptyString(repositoryRoot)) {
    throw new TypeError("repositoryRoot must be a non-empty path");
  }
  const repository = await realpath(repositoryRoot);
  const packageJson = JSON.parse(await readFile(path.join(repository, "package.json"), "utf8"));
  if (packageJson.name !== "visp-hyper-agent") {
    throw new TypeError("repositoryRoot must identify visp-hyper-agent");
  }
  const output = path.join(ownedRoot, "repository pack");
  const cache = path.join(ownedRoot, "repository pack cache");
  await mkdir(output);
  await mkdir(cache);
  try {
    await execFileAsync(
      npmCommand,
      ["pack", "--ignore-scripts", "--pack-destination", output],
      {
        cwd: repository,
        encoding: "utf8",
        env: npmEnvironment(cache),
        maxBuffer: 2 * 1024 * 1024,
        timeout: 60_000,
      },
    );
  } catch {
    throw new Error("Packing the Hyper repository failed; build it first and ensure npm is available");
  }
  const packed = (await readdir(output)).filter((entry) => entry.endsWith(".tgz"));
  if (packed.length !== 1) {
    throw new Error("npm pack did not produce exactly one Hyper tarball");
  }
  return path.join(output, packed[0]);
}

async function packRepositoryDependencies(repositoryRoot, ownedRoot, npmCommand) {
  const repository = await realpath(repositoryRoot);
  const rootManifestPath = path.join(repository, "package.json");
  const rootManifest = JSON.parse(await readFile(rootManifestPath, "utf8"));
  const packRoot = path.join(ownedRoot, "dependency packs");
  const packCacheRoot = path.join(ownedRoot, "dependency pack cache");
  const stagingRoot = path.join(ownedRoot, "dependency staging");
  await mkdir(packRoot);
  await mkdir(packCacheRoot);
  await mkdir(stagingRoot);
  const queue = [{
    manifest: rootManifest,
    manifestPath: rootManifestPath,
    packageRoot: repository,
  }];
  const packed = new Set();
  const tarballs = [];
  while (queue.length > 0) {
    const owner = queue.shift();
    for (const dependency of dependencyNames(owner.manifest)) {
      const resolved = await resolveDependency(owner.manifestPath, owner.packageRoot, dependency);
      const manifestPath = path.join(resolved, "package.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const identity = `${manifest.name}@${manifest.version}`;
      if (packed.has(identity)) continue;
      packed.add(identity);
      const staged = path.join(stagingRoot, sha256Hex(identity).slice(0, 16));
      await cp(resolved, staged, {
        dereference: true,
        errorOnExist: true,
        force: false,
        recursive: true,
      });
      const before = new Set(await readdir(packRoot));
      try {
        await execFileAsync(
          npmCommand,
          ["pack", "--ignore-scripts", "--pack-destination", packRoot],
          {
            cwd: staged,
            encoding: "utf8",
            env: npmEnvironment(packCacheRoot),
            maxBuffer: 2 * 1024 * 1024,
            timeout: 60_000,
          },
        );
      } catch {
        throw new Error(`Could not pack installed dependency ${identity}`);
      }
      const created = (await readdir(packRoot))
        .filter((entry) => entry.endsWith(".tgz") && !before.has(entry));
      if (created.length !== 1) {
        throw new Error(`Packing ${identity} did not produce exactly one dependency tarball`);
      }
      const tarball = path.join(packRoot, created[0]);
      tarballs.push({ name: manifest.name, tarball, version: manifest.version });
      queue.push({ manifest, manifestPath, packageRoot: resolved });
    }
  }
  const names = new Set();
  for (const dependency of tarballs) {
    if (names.has(dependency.name)) {
      throw new Error(`Repository dependency graph contains multiple versions of ${dependency.name}`);
    }
    names.add(dependency.name);
  }
  return tarballs;
}

async function installRepositoryPackageGraph({
  dependencyTarballs,
  fixtureRoot,
  hyperTarball,
  npmCommand,
}) {
  await mkdir(fixtureRoot);
  const cache = path.join(fixtureRoot, ".npm-cache");
  await mkdir(cache);
  const dependencies = {
    "visp-hyper-agent": `file:${hyperTarball}`,
  };
  for (const dependency of dependencyTarballs) {
    dependencies[dependency.name] = `file:${dependency.tarball}`;
  }
  await writeFile(
    path.join(fixtureRoot, "package.json"),
    canonicalStringify({
      name: "visp-phase-4-runtime-install",
      private: true,
      dependencies,
    }),
    { flag: "wx", mode: 0o600 },
  );
  try {
    await execFileAsync(
      npmCommand,
      [
        "install",
        "--offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        "--omit=dev",
        "--cache",
        cache,
      ],
      {
        cwd: fixtureRoot,
        encoding: "utf8",
        env: npmEnvironment(cache),
        maxBuffer: 2 * 1024 * 1024,
        timeout: 60_000,
      },
    );
  } catch {
    throw new Error("Offline local dependency-graph install failed");
  }
  const installed = [];
  for (const name of Object.keys(dependencies).sort()) {
    const manifest = JSON.parse(await readFile(
      path.join(fixtureRoot, "node_modules", ...name.split("/"), "package.json"),
      "utf8",
    ));
    if (manifest.name !== name || !nonEmptyString(manifest.version)) {
      throw new Error(`Installed dependency identity differs for ${name}`);
    }
    installed.push({ name, version: manifest.version });
  }
  const tree = {
    dependencies: installed,
    name: "visp-phase-4-runtime-install",
  };
  return {
    bins: await inspectInstalledBins({ fixtureRoot }),
    cache: {
      inventorySha256: sha256Hex(canonicalStringify(
        dependencyTarballs.map(({ name, version }) => ({ name, version })),
      )),
      mode: "repository_local_tarballs",
    },
    dependencyTree: {
      sha256: sha256Hex(canonicalStringify(tree)),
      tree,
    },
    lifecycleScriptsDisabled: true,
    offline: true,
    tool: { name: "npm", version: null },
  };
}

async function resolveDependency(ownerManifestPath, ownerRoot, dependency) {
  const direct = path.join(ownerRoot, "node_modules", ...dependency.split("/"));
  try {
    if ((await stat(path.join(direct, "package.json"))).isFile()) return await realpath(direct);
  } catch {
    // Fall through to Node resolution for pnpm and other linked layouts.
  }
  const require = createRequire(ownerManifestPath);
  try {
    return path.dirname(require.resolve(`${dependency}/package.json`));
  } catch {
    const entry = require.resolve(dependency);
    let current = path.dirname(entry);
    while (true) {
      try {
        const manifest = JSON.parse(await readFile(path.join(current, "package.json"), "utf8"));
        if (manifest.name === dependency) return current;
      } catch {
        // Continue walking toward the resolved package root.
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw new Error(`Installed dependency is unavailable: ${dependency}`);
}

function dependencyNames(manifest) {
  return [...new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ])].sort();
}

async function findExecutable(command) {
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension.toLowerCase()}`);
      try {
        await access(candidate, fsConstants.X_OK);
        return await realpath(candidate);
      } catch {
        // Continue through the explicit PATH candidates.
      }
    }
  }
  return null;
}

async function executableExists(directory, command) {
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];
  for (const extension of extensions) {
    try {
      await access(path.join(directory, `${command}${extension.toLowerCase()}`), fsConstants.X_OK);
      return true;
    } catch {
      // Continue through the isolated runtime directory.
    }
  }
  return false;
}

function npmEnvironment(cache) {
  return {
    ...process.env,
    npm_config_audit: "false",
    npm_config_cache: cache,
    npm_config_fund: "false",
    npm_config_ignore_scripts: "true",
    npm_config_offline: "true",
    npm_config_update_notifier: "false",
  };
}

function verifyRuntime(report) {
  if (report.package?.name !== "visp-hyper-agent"
    || !nonEmptyString(report.package.version)
    || !HASH.test(report.package.binSha256 ?? "")
    || !HASH.test(report.package.dependencyTreeSha256 ?? "")
    || !["caller_snapshot", "repository_local_tarballs"].includes(report.package.installCacheMode)
    || report.package.offlineInstall !== true
    || report.package.lifecycleScriptsDisabled !== true
    || !Array.isArray(report.runtime?.hosts)
    || report.runtime.hosts.length !== HOSTS.length
    || report.summary?.runtimeVerified !== true
    || report.summary?.runtimeHostsVerified !== HOSTS.length) {
    throw new Error("Phase 4 installed runtime summary is invalid");
  }
  for (const [index, host] of HOSTS.entries()) {
    const runtime = report.runtime.hosts[index];
    if (runtime?.configuredHost !== host
      || runtime.assets !== "pass"
      || runtime.doctor !== "pass"
      || runtime.gitFallback !== "installed"
      || runtime.ciFallback !== "installed"
      || runtime.mcp !== "pass"
      || runtime.skillMode !== "review"
      || runtime.kitMode !== "local_checked"
      || runtime.hostBinary !== (host === "generic" ? "not_required" : "intentionally_absent")
      || runtime.hostSelection !== (host === "generic" ? "manual" : "fallback")) {
      throw new Error(`Phase 4 ${host} installed runtime is invalid`);
    }
  }
}

function finalizeReport(report) {
  const unhashed = structuredClone(report);
  delete unhashed.reportSha256;
  const finalized = {
    ...unhashed,
    reportSha256: sha256Hex(canonicalStringify(unhashed)),
  };
  return JSON.parse(canonicalStringify(finalized));
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
    throw new Error(`${label} contains missing or unknown fields`);
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isHttpUrl(value) {
  if (!nonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

async function readModelMap(hostRoot) {
  try {
    const parsed = JSON.parse(await readFile(path.join(hostRoot, "model-map.json"), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function renderModels(content, models) {
  return content
    .replaceAll("{{COORDINATOR_MODEL}}", models.coordinator ?? "{{COORDINATOR_MODEL}}")
    .replaceAll("{{SCOUT_MODEL}}", models.scout ?? "{{SCOUT_MODEL}}")
    .replaceAll("{{IMPLEMENTER_MODEL}}", models.implementer ?? "{{IMPLEMENTER_MODEL}}");
}

function safeRelative(value) {
  return typeof value === "string"
    && value.length > 0
    && !path.isAbsolute(value)
    && !value.includes("\\")
    && value.split("/").every((part) => part && part !== "." && part !== "..");
}
