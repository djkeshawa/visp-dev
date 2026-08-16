/**
 * Installing the packed coordinator and driving it inside each of the five host
 * layouts, with none of those hosts present.
 *
 * The absence is deliberate and asserted: if a host's own binary were beside
 * Git on PATH, the run would exercise the native path and prove nothing about
 * the fallback, which is what a user without that host receives. `doctor` is
 * then required to WARN about the missing host rather than pass silently — a
 * fallback nobody is told about is indistinguishable from a broken install.
 */
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path, { delimiter } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import { sha256Hex } from "../../platform/canonical-json.mjs";
import {
  cleanupOwnedRoot,
  createOwnedRoot,
  installLocalTarball,
  runProcess,
} from "../../toolchain/index.mjs";
import { HOST_EXECUTABLES } from "./manifest.mjs";
import {
  copyTarballIntoOwnedRoot,
  installRepositoryPackageGraph,
  packRepository,
  packRepositoryDependencies,
} from "./package-graph.mjs";
import {
  createHostAssetsReport,
  finalizeReport,
  verifyHostAssetsReport,
} from "./report.mjs";

const execFileAsync = promisify(execFile);

/**
 * Which host binaries must NOT be reachable, and where Git is.
 *
 * The runtime PATH holds Git and nothing else, so the coordinator resolves no
 * host tool and the fallback path is what gets exercised.
 */
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

let runtimeInvocation = 0;

/**
 * Runs the packed CLI in-process under a capture shim.
 *
 * The shim exists because the coordinator writes through `console`, and reading
 * the parent's stdout would mix its own diagnostics into the observation.
 */
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

async function verifyHostRuntime({ captureRunner, cliEntry, example, gitExecutable, ownedRoot, runtimePath }) {
  const projectPath = path.join(ownedRoot, "host projects", `${example.host} example`);
  await mkdir(projectPath, { recursive: true });
  const runtimeEnvironment = { CI: "true", LANG: "C", LC_ALL: "C", PATH: runtimePath, TZ: "UTC" };

  const init = await runHyper(
    captureRunner, cliEntry, projectPath,
    ["init", "--tool", example.host], runtimeEnvironment, "host init",
  );
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
    captureRunner, cliEntry, projectPath, ["doctor", "--json"], runtimeEnvironment, "doctor",
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
  if (doctor.success !== true) throw new Error(`${example.host} doctor reported a failed runtime`);

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

export async function runPackedHostAssets({
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
      throw new Error("Packed host-asset input is not a compatible visp-hyper-agent package");
    }

    const staticReport = await createHostAssetsReport({
      packageSha256: sha256Hex(await readFile(packageInput)),
      templatesRoot: path.join(packageRoot, "templates"),
    });

    const gitExecutable = await findExecutable("git");
    if (!gitExecutable) throw new Error("Git is required for host-asset fallback verification");
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

    const runtimeHosts = [];
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
    if (!bin) throw new Error("Clean install did not expose the visp-hyper binary");

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
      runtime: { hosts: runtimeHosts },
      summary: {
        ...staticReport.summary,
        runtimeHostsVerified: runtimeHosts.length,
        runtimeVerified: true,
      },
    });
    verifyHostAssetsReport(report, { requireRuntime: true });
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
        // A cleanup failure must not mask the real failure that caused it.
        if (!failure) throw cleanupError;
      }
    }
  }
}
