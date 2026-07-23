import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const OWNED_PREFIX = "visp-compatibility-lab-";
const OWNED_MARKER = ".visp-compatibility-lab-owned";
const OWNED_MARKER_CONTENT = "visp-dev compatibility laboratory owned root\n";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_KILL_GRACE_MS = 100;
const DEFAULT_FINALIZATION_MS = 250;
const MAX_GIT_TREE_BYTES = 16 * 1024 * 1024;
const MAX_GIT_BLOB_BYTES = 64 * 1024 * 1024;
const LOCAL_TARBALL_PLACEHOLDER = "file:__VISP_LOCAL_TARBALL__";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertPlainRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function rejectUnknownKeys(record, allowed, label) {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new TypeError(`Unknown ${label} key: ${key}`);
    }
  }
}

function sortJson(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON accepts only finite numbers");
    return value;
  }
  if (typeof value !== "object" || seen.has(value)) {
    throw new TypeError("Canonical JSON accepts only acyclic JSON values");
  }
  seen.add(value);
  let sorted;
  if (Array.isArray(value)) {
    sorted = value.map((entry) => sortJson(entry, seen));
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError("Canonical JSON accepts only plain objects");
    }
    sorted = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new TypeError("Canonical JSON does not accept undefined");
      sorted[key] = sortJson(value[key], seen);
    }
  }
  seen.delete(value);
  return sorted;
}

export function canonicalStringify(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function validateCommand(command, args) {
  if (typeof command !== "string" || command.length === 0 || command.includes("\0")) {
    throw new TypeError("command must be a non-empty string without NUL bytes");
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    throw new TypeError("args must be an array of strings without NUL bytes");
  }
}

function makeOutputCollector(maxOutputBytes, forbiddenOutputFragments) {
  const hash = createHash("sha256");
  const chunks = [];
  const forbidden = forbiddenOutputFragments.map((fragment) => Buffer.from(fragment));
  const overlapBytes = Math.max(0, ...forbidden.map((fragment) => fragment.length - 1));
  let capturedBytes = 0;
  let bytes = 0;
  let overlap = Buffer.alloc(0);
  let forbiddenOutputDetected = false;
  return {
    add(chunk) {
      const buffer = Buffer.from(chunk);
      hash.update(buffer);
      bytes += buffer.length;
      if (!forbiddenOutputDetected && forbidden.length > 0) {
        const searchable = overlap.length === 0 ? buffer : Buffer.concat([overlap, buffer]);
        forbiddenOutputDetected = forbidden.some((fragment) => searchable.indexOf(fragment) !== -1);
        overlap = overlapBytes === 0 ? Buffer.alloc(0) : searchable.subarray(Math.max(0, searchable.length - overlapBytes));
      }
      if (capturedBytes < maxOutputBytes) {
        const slice = buffer.subarray(0, maxOutputBytes - capturedBytes);
        chunks.push(slice);
        capturedBytes += slice.length;
      }
    },
    finish() {
      const buffer = Buffer.concat(chunks);
      const observation = {
        bytes,
        sha256: hash.digest("hex"),
        text: buffer.toString("utf8"),
        truncated: bytes > capturedBytes,
        forbiddenOutputDetected,
      };
      Object.defineProperty(observation, "buffer", { enumerable: false, value: buffer });
      return observation;
    },
  };
}

export async function runProcess(command, args, options = {}) {
  validateCommand(command, args);
  assertPlainRecord(options, "options");
  rejectUnknownKeys(
    options,
    new Set(["cwd", "env", "timeoutMs", "maxOutputBytes", "killGraceMs", "finalizationMs", "forbiddenOutputFragments", "stdin"]),
    "option",
  );
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const finalizationMs = options.finalizationMs ?? DEFAULT_FINALIZATION_MS;
  const forbiddenOutputFragments = options.forbiddenOutputFragments ?? [];
  const stdin = options.stdin;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError("timeoutMs must be a positive integer");
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 0) throw new TypeError("maxOutputBytes must be a non-negative integer");
  if (!Number.isInteger(killGraceMs) || killGraceMs < 0) throw new TypeError("killGraceMs must be a non-negative integer");
  if (!Number.isInteger(finalizationMs) || finalizationMs < 0) throw new TypeError("finalizationMs must be a non-negative integer");
  if (!Array.isArray(forbiddenOutputFragments)
    || forbiddenOutputFragments.some((fragment) => typeof fragment !== "string" || fragment.length === 0)) {
    throw new TypeError("forbiddenOutputFragments must be an array of non-empty strings");
  }
  if (stdin !== undefined && typeof stdin !== "string" && !Buffer.isBuffer(stdin)) {
    throw new TypeError("stdin must be a string or Buffer");
  }

  return new Promise((resolve) => {
    const stdout = makeOutputCollector(maxOutputBytes, forbiddenOutputFragments);
    const stderr = makeOutputCollector(maxOutputBytes, forbiddenOutputFragments);
    let child;
    let spawnError = null;
    let timedOut = false;
    let settled = false;
    let timeoutTimer;
    let killTimer;
    let finalizationTimer;
    let hardKillSent = false;
    let closeResult = null;
    const useProcessGroup = process.platform !== "win32";

    const finish = (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      clearTimeout(finalizationTimer);
      const stdoutObservation = stdout.finish();
      const stderrObservation = stderr.finish();
      resolve({
        exitCode: spawnError ? null : exitCode,
        signal: signal ?? null,
        spawnError,
        timedOut,
        forbiddenOutputDetected: stdoutObservation.forbiddenOutputDetected || stderrObservation.forbiddenOutputDetected,
        stdout: stdoutObservation,
        stderr: stderrObservation,
      });
    };

    const terminate = (signal) => {
      try {
        if (useProcessGroup && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if (error.code !== "ESRCH") {
          const rawMessage = String(error.message);
          spawnError ??= { code: error.code ?? "TERMINATION_ERROR", messageSha256: sha256Hex(rawMessage) };
        }
      }
    };

    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        detached: useProcessGroup,
        shell: false,
        stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      const rawMessage = String(error.message);
      spawnError = { code: error.code ?? "SPAWN_ERROR", messageSha256: sha256Hex(rawMessage) };
      finish(null, null);
      return;
    }

    child.stdout.on("data", (chunk) => stdout.add(chunk));
    child.stderr.on("data", (chunk) => stderr.add(chunk));
    if (stdin !== undefined) child.stdin.end(stdin);
    child.on("error", (error) => {
      const rawMessage = String(error.message);
      spawnError = { code: error.code ?? "SPAWN_ERROR", messageSha256: sha256Hex(rawMessage) };
    });
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminate("SIGTERM");
      killTimer = setTimeout(() => {
        hardKillSent = true;
        terminate("SIGKILL");
        if (closeResult) {
          finish(closeResult.exitCode, closeResult.signal);
          return;
        }
        finalizationTimer = setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          finish(null, "SIGKILL");
        }, finalizationMs);
      }, killGraceMs);
    }, timeoutMs);
    timeoutTimer.unref();
    child.on("close", (exitCode, signal) => {
      if (!timedOut) {
        finish(exitCode, signal);
        return;
      }
      closeResult = { exitCode, signal };
      if (hardKillSent) finish(exitCode, signal);
    });
  });
}

async function runChecked(command, args, options, label) {
  const result = await runProcess(command, args, options);
  if (result.spawnError || result.timedOut || result.exitCode !== 0) {
    const error = new Error(`${label} failed`);
    error.code = "PROCESS_FAILED";
    error.observation = result;
    throw error;
  }
  return result;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function findOwnedRoot(candidate) {
  let current = path.resolve(candidate);
  while (true) {
    try {
      const marker = await readFile(path.join(current, OWNED_MARKER), "utf8");
      if (marker === OWNED_MARKER_CONTENT && path.basename(current).startsWith(OWNED_PREFIX)) return current;
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function requireOwnedPath(candidate, label) {
  const absolute = path.resolve(candidate);
  const ownedRoot = await findOwnedRoot(absolute);
  if (!ownedRoot || !isWithin(ownedRoot, absolute) || absolute === ownedRoot) {
    throw new Error(`${label} must be inside a laboratory-owned temporary root`);
  }
  return { absolute, ownedRoot };
}

export async function createOwnedRoot({ baseDirectory = tmpdir() } = {}) {
  const base = await realpath(baseDirectory);
  const root = await mkdtemp(path.join(base, OWNED_PREFIX));
  await writeFile(path.join(root, OWNED_MARKER), OWNED_MARKER_CONTENT, { flag: "wx", mode: 0o600 });
  return { root };
}

export async function cleanupOwnedRoot({ root, keep = false }) {
  if (typeof root !== "string" || root.length === 0) throw new TypeError("root must be a non-empty string");
  const absolute = path.resolve(root);
  if (!path.basename(absolute).startsWith(OWNED_PREFIX)) throw new Error("Temporary root is not owned by the laboratory");
  let marker;
  try {
    marker = await readFile(path.join(absolute, OWNED_MARKER), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("Temporary root is not owned by the laboratory");
    throw error;
  }
  if (marker !== OWNED_MARKER_CONTENT) throw new Error("Temporary root is not owned by the laboratory");
  if (keep) return { kept: true };
  await rm(absolute, { recursive: true, force: false });
  return { kept: false };
}

function trimLine(output) {
  return output.text.trim();
}

async function runGit(args, options = {}) {
  const gitExecutable = await findExecutable("git");
  if (!gitExecutable) throw new Error("Git executable unavailable");
  const environment = {
    ...stableEnvironment([gitExecutable]),
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "0",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
  };
  return runProcess(
    gitExecutable,
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.attributesFile=/dev/null",
      "-c",
      "core.safecrlf=true",
      ...args,
    ],
    { ...options, env: environment },
  );
}

async function runGitChecked(args, options, label) {
  const result = await runGit(args, options);
  if (result.spawnError || result.timedOut || result.exitCode !== 0) {
    const error = new Error(`${label} failed`);
    error.code = "GIT_PROCESS_FAILED";
    Object.defineProperty(error, "observation", { enumerable: false, value: result });
    throw error;
  }
  return result;
}

export async function resolveCommit({ repositoryRoot, commit }) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) {
    throw new TypeError("repositoryRoot must be an explicit non-empty path");
  }
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new TypeError("commit must be a full 40-character lowercase hexadecimal ID");
  }
  let root;
  try {
    root = await realpath(repositoryRoot);
  } catch {
    throw new Error("repositoryRoot must identify an existing Git repository root");
  }
  const topLevelResult = await runGit(["-C", root, "rev-parse", "--show-toplevel"]);
  if (topLevelResult.exitCode !== 0 || topLevelResult.spawnError) {
    throw new Error("repositoryRoot must identify an existing Git repository root");
  }
  const topLevel = await realpath(trimLine(topLevelResult.stdout));
  if (topLevel !== root) throw new Error("repositoryRoot must be the exact Git repository root");

  const typeResult = await runGit(["-C", root, "cat-file", "-t", commit]);
  if (typeResult.exitCode !== 0 || trimLine(typeResult.stdout) !== "commit") {
    throw new Error("Revision must identify an existing commit object");
  }
  const commitResult = await runGitChecked(["-C", root, "rev-parse", `${commit}^{commit}`], {}, "Commit resolution");
  const treeResult = await runGitChecked(["-C", root, "show", "-s", "--format=%T", commit], {}, "Tree resolution");
  const exactCommit = trimLine(commitResult.stdout);
  const tree = trimLine(treeResult.stdout);
  if (exactCommit !== commit || !/^[0-9a-f]{40}$/.test(tree)) {
    throw new Error("Git returned an invalid commit or tree identity");
  }
  return { commit: exactCommit, tree };
}

export async function snapshotCommit({ repositoryRoot, commit, destination }) {
  const { absolute } = await requireOwnedPath(destination, "destination");
  const resolved = await resolveCommit({ repositoryRoot, commit });
  const objectRepository = `${absolute}.git-objects`;
  try {
    await runGitChecked(
      ["clone", "--quiet", "--bare", "--no-hardlinks", await realpath(repositoryRoot), objectRepository],
      {},
      "Disposable object clone",
    );
    const treeResult = await runGitChecked(
      ["--git-dir", objectRepository, "ls-tree", "-rz", "--full-tree", resolved.commit],
      { maxOutputBytes: MAX_GIT_TREE_BYTES },
      "Committed tree inventory",
    );
    if (treeResult.stdout.truncated || treeResult.stderr.truncated) {
      throw new Error("Committed tree inventory exceeded bounded capture");
    }
    await mkdir(absolute);
    const records = treeResult.stdout.buffer.subarray(0, treeResult.stdout.bytes).toString("utf8").split("\0").filter(Boolean);
    const seenPaths = new Set();
    for (const record of records) {
      const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/u.exec(record);
      if (!match) throw new Error("Committed tree contains an unsupported entry");
      const [, mode, objectId, relativePath] = match;
      if (relativePath.includes("\uFFFD")
        || relativePath.includes("\\")
        || path.posix.isAbsolute(relativePath)
        || path.posix.normalize(relativePath) !== relativePath
        || relativePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
        || seenPaths.has(relativePath)) {
        throw new Error("Committed tree contains an unsafe path");
      }
      seenPaths.add(relativePath);
      const sizeResult = await runGitChecked(
        ["--git-dir", objectRepository, "cat-file", "-s", objectId],
        {},
        "Committed blob size",
      );
      const byteSize = Number(trimLine(sizeResult.stdout));
      if (!Number.isSafeInteger(byteSize) || byteSize < 0 || byteSize > MAX_GIT_BLOB_BYTES) {
        throw new Error("Committed blob exceeds the supported snapshot bound");
      }
      const blobResult = await runGitChecked(
        ["--git-dir", objectRepository, "cat-file", "blob", objectId],
        { maxOutputBytes: byteSize },
        "Committed blob read",
      );
      if (blobResult.stdout.truncated || blobResult.stdout.bytes !== byteSize || blobResult.stderr.bytes !== 0) {
        throw new Error("Committed blob read was incomplete");
      }
      const bytes = blobResult.stdout.buffer;
      const computedObjectId = createHash("sha1")
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex");
      if (computedObjectId !== objectId) throw new Error("Committed blob identity mismatch");
      const outputPath = path.join(absolute, ...relativePath.split("/"));
      await mkdir(path.dirname(outputPath), { recursive: true });
      const expectedMode = mode === "100755" ? 0o755 : 0o644;
      await writeFile(outputPath, bytes, { flag: "wx", mode: expectedMode });
      await chmod(outputPath, expectedMode);
      const materialized = await lstat(outputPath);
      if (!materialized.isFile() || (materialized.mode & 0o777) !== expectedMode) {
        throw new Error("Committed blob mode could not be materialized faithfully");
      }
    }
  } catch (error) {
    await rm(absolute, { recursive: true, force: true });
    await rm(objectRepository, { recursive: true, force: true });
    throw error;
  }
  return resolved;
}

async function findExecutable(command) {
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    try {
      await access(command, fsConstants.X_OK);
      return path.resolve(command);
    } catch {
      return null;
    }
  }
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, command);
    try {
      await access(candidate, fsConstants.X_OK);
      return path.resolve(candidate);
    } catch {
      // Continue searching the explicit PATH entries.
    }
  }
  return null;
}

function stableEnvironment(executables, binDirectory = null) {
  const pathEntries = [
    binDirectory,
    path.dirname(process.execPath),
    ...executables.map((executable) => path.dirname(executable)),
    "/usr/bin",
    "/bin",
  ].filter(Boolean);
  const environment = {
    CI: "true",
    LANG: "C",
    LC_ALL: "C",
    PATH: [...new Set(pathEntries)].join(path.delimiter),
    NODE_PATH: "",
    TZ: "UTC",
  };
  if (process.platform === "win32") {
    for (const key of ["ComSpec", "PATHEXT", "SystemRoot", "WINDIR"]) {
      if (process.env[key] !== undefined) environment[key] = process.env[key];
    }
  }
  return environment;
}

async function npmEnvironment({ executables, configurationDirectory, cacheDirectory, ignoreScripts }) {
  await mkdir(configurationDirectory, { recursive: true });
  const userConfig = path.join(configurationDirectory, "user.npmrc");
  const globalConfig = path.join(configurationDirectory, "global.npmrc");
  await writeFile(userConfig, "", { flag: "wx" });
  await writeFile(globalConfig, "", { flag: "wx" });
  return {
    ...stableEnvironment(executables),
    npm_config_audit: "false",
    npm_config_cache: cacheDirectory,
    npm_config_fund: "false",
    npm_config_globalconfig: globalConfig,
    npm_config_ignore_scripts: ignoreScripts ? "true" : "false",
    npm_config_offline: "true",
    npm_config_update_notifier: "false",
    npm_config_userconfig: userConfig,
  };
}

function normalizeBins(packageJson) {
  if (packageJson.bin === undefined) return [];
  let bins;
  if (typeof packageJson.bin === "string") {
    const shortName = packageJson.name.startsWith("@") ? packageJson.name.split("/")[1] : packageJson.name;
    bins = { [shortName]: packageJson.bin };
  } else {
    assertPlainRecord(packageJson.bin, "package.json bin");
    bins = packageJson.bin;
  }
  return Object.entries(bins)
    .map(([name, binPath]) => {
      if (typeof binPath !== "string" || binPath.length === 0) throw new TypeError(`Invalid declared bin path for ${name}`);
      return { name, path: binPath.replaceAll(path.sep, "/") };
    })
    .sort((left, right) => compareText(left.name, right.name));
}

function packageIdentity(packageJson) {
  if (typeof packageJson.name !== "string" || typeof packageJson.version !== "string") {
    throw new Error("package.json must declare string name and version fields");
  }
  return { name: packageJson.name, version: packageJson.version, declaredBins: normalizeBins(packageJson) };
}

async function packageSnapshot({
  snapshotRoot,
  outputDirectory,
  npmCommand,
  packageManagerExecutable,
  maxTarInventoryBytes,
}) {
  const snapshot = await realpath(snapshotRoot);
  const { absolute: output } = await requireOwnedPath(outputDirectory, "outputDirectory");
  await mkdir(output, { recursive: false });
  const npmExecutable = await findExecutable(npmCommand);
  if (!npmExecutable) throw new Error("Package tool unavailable");
  const environment = await npmEnvironment({
    executables: [npmExecutable, packageManagerExecutable].filter(Boolean),
    configurationDirectory: path.join(output, ".npm-config"),
    cacheDirectory: path.join(output, ".npm-cache"),
    ignoreScripts: false,
  });
  const versionResult = await runChecked(npmExecutable, ["--version"], { env: environment }, "Package tool version");
  await runChecked(
    npmExecutable,
    ["pack", "--offline", "--ignore-scripts=false", "--pack-destination", output],
    { cwd: snapshot, env: environment },
    "Package pack",
  );
  const packedFiles = (await readdir(output)).filter((name) => name.endsWith(".tgz")).sort();
  if (packedFiles.length !== 1) throw new Error("Package tool must create exactly one tarball");
  const [filename] = packedFiles;
  const tarballPath = path.join(output, filename);
  const bytes = await readFile(tarballPath);
  const tarExecutable = await findExecutable("tar");
  if (!tarExecutable) throw new Error("Tar inventory tool unavailable");
  const inventoryResult = await runChecked(
    tarExecutable,
    ["-tf", tarballPath],
    { maxOutputBytes: maxTarInventoryBytes },
    "Tar inventory",
  );
  if (inventoryResult.stdout.truncated || inventoryResult.stderr.truncated) {
    const error = new Error("Tar inventory output exceeded bounded capture");
    error.code = "TAR_INVENTORY_TRUNCATED";
    error.observation = inventoryResult;
    throw error;
  }
  const members = inventoryResult.stdout.text.split(/\r?\n/u).filter(Boolean).sort();
  if (!members.includes("package/package.json")) throw new Error("Packed archive is missing package/package.json");
  const packedManifestResult = await runChecked(
    tarExecutable,
    ["-xOf", tarballPath, "package/package.json"],
    { maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES },
    "Packed package identity",
  );
  if (packedManifestResult.stdout.truncated || packedManifestResult.stderr.bytes !== 0) {
    throw new Error("Packed package identity could not be read faithfully");
  }
  let packedManifest;
  try {
    packedManifest = JSON.parse(packedManifestResult.stdout.text);
  } catch {
    throw new Error("Packed package identity is malformed");
  }
  const observation = {
    byteSize: bytes.length,
    memberListSha256: sha256Hex(`${members.join("\n")}\n`),
    memberListBytes: inventoryResult.stdout.bytes,
    members,
    package: packageIdentity(packedManifest),
    sha256: sha256Hex(bytes),
    tool: { lifecycleScriptsPolicy: "required", name: "npm", version: trimLine(versionResult.stdout) },
  };
  Object.defineProperties(observation, {
    bytes: { value: bytes, enumerable: false },
    tarballPath: { value: tarballPath, enumerable: false },
  });
  return observation;
}

export function assertMatchingPacks(first, second) {
  const byteEqual = Buffer.isBuffer(first.bytes) && Buffer.isBuffer(second.bytes)
    ? first.bytes.equals(second.bytes)
    : first.sha256 === second.sha256 && first.byteSize === second.byteSize;
  if (!byteEqual) throw new Error("Independent package bytes differ");
  if (first.sha256 !== second.sha256 || first.byteSize !== second.byteSize || first.memberListSha256 !== second.memberListSha256) {
    throw new Error("Independent package inventory differs");
  }
  if (canonicalStringify(first.package) !== canonicalStringify(second.package)) {
    throw new Error("Independent packed package identities differ");
  }
}

export async function packPackageTwice({
  repositoryRoot,
  commit,
  ownedRoot,
  npmCommand = "npm",
  packageManagerCommand,
  offlineStoreSource,
  maxTarInventoryBytes = DEFAULT_MAX_OUTPUT_BYTES,
}) {
  if (!Number.isInteger(maxTarInventoryBytes) || maxTarInventoryBytes <= 0) {
    throw new TypeError("maxTarInventoryBytes must be a positive integer");
  }
  const owned = await realpath(ownedRoot);
  const markerRoot = await findOwnedRoot(owned);
  if (markerRoot !== owned) throw new Error("ownedRoot is not a laboratory-owned temporary root");
  const resolved = await resolveCommit({ repositoryRoot, commit });
  const snapshot1 = path.join(owned, "snapshot-1");
  const snapshot2 = path.join(owned, "snapshot-2");
  await snapshotCommit({ repositoryRoot, commit, destination: snapshot1 });
  await snapshotCommit({ repositoryRoot, commit, destination: snapshot2 });
  const firstPreparation = await preparePackageSnapshot({
    snapshotRoot: snapshot1,
    preparationDirectory: path.join(owned, "preparation-1"),
    offlineStoreSource,
    packageManagerCommand,
    npmCommand,
  });
  const secondPreparation = await preparePackageSnapshot({
    snapshotRoot: snapshot2,
    preparationDirectory: path.join(owned, "preparation-2"),
    offlineStoreSource,
    packageManagerCommand,
    npmCommand,
  });
  if (canonicalStringify(firstPreparation) !== canonicalStringify(secondPreparation)) {
    throw new Error("Independent package preparations differ");
  }
  const first = await packageSnapshot({
    snapshotRoot: snapshot1,
    outputDirectory: path.join(owned, "pack-1"),
    npmCommand,
    packageManagerExecutable: firstPreparation?.executable,
    maxTarInventoryBytes,
  });
  const second = await packageSnapshot({
    snapshotRoot: snapshot2,
    outputDirectory: path.join(owned, "pack-2"),
    npmCommand,
    packageManagerExecutable: secondPreparation?.executable,
    maxTarInventoryBytes,
  });
  assertMatchingPacks(first, second);
  return {
    ...resolved,
    package: first.package,
    preparations: {
      first: publicPreparation(firstPreparation),
      second: publicPreparation(secondPreparation),
    },
    first,
    second,
    tarballPath: first.tarballPath,
  };
}

export async function inspectInstalledBins({ fixtureRoot }) {
  const fixture = await realpath(fixtureRoot);
  const owned = await findOwnedRoot(fixture);
  if (!owned) throw new Error("fixtureRoot must be inside a laboratory-owned temporary root");
  const binDirectory = path.join(fixture, "node_modules", ".bin");
  let names;
  try {
    names = (await readdir(binDirectory)).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const bins = [];
  for (const name of names) {
    const binPath = path.join(binDirectory, name);
    const entry = await lstat(binPath);
    if (!entry.isFile() && !entry.isSymbolicLink()) throw new Error(`Installed bin ${name} is not executable content`);
    const target = await realpath(binPath);
    if (!isWithin(fixture, target)) throw new Error(`Installed bin ${name} resolves outside install fixture`);
    const bytes = await readFile(target);
    bins.push({ name, sha256: sha256Hex(bytes), target: path.relative(fixture, target).split(path.sep).join("/") });
  }
  return bins;
}

async function cacheInventory(root) {
  const entries = [];
  async function walk(directory, relativeDirectory) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => compareText(left.name, right.name));
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const relative = path.posix.join(relativeDirectory, child.name);
      const metadata = await lstat(absolute);
      const mode = metadata.mode & 0o777;
      if (child.isSymbolicLink()) {
        const target = await readlink(absolute);
        const resolvedTarget = path.resolve(path.dirname(absolute), target);
        if (path.isAbsolute(target) || !isWithin(root, resolvedTarget)) {
          throw new Error("Offline cache contains an escaping symbolic link");
        }
        entries.push({ mode, path: relative, target, type: "symbolic_link" });
      } else if (child.isDirectory()) {
        entries.push({ mode, path: `${relative}/`, type: "directory" });
        await walk(absolute, relative);
      } else if (child.isFile()) {
        const bytes = await readFile(absolute);
        entries.push({ byteSize: bytes.length, mode, path: relative, sha256: sha256Hex(bytes), type: "file" });
      } else {
        throw new Error("Offline cache contains an unsupported filesystem entry");
      }
    }
  }
  await walk(root, "");
  return sha256Hex(canonicalStringify(entries));
}

async function prepareOfflineCache(source, target) {
  if (source === undefined) {
    await mkdir(target);
    return { inventorySha256: sha256Hex(canonicalStringify([])), mode: "empty" };
  }
  if (typeof source !== "string" || source.length === 0) throw new TypeError("offlineCacheSource must be an explicit non-empty path");
  let sourceRoot;
  try {
    sourceRoot = await realpath(source);
  } catch {
    throw new Error("Offline cache source unavailable");
  }
  if (!(await stat(sourceRoot)).isDirectory()) throw new Error("Offline cache source must be a directory");
  const sourceHash = await cacheInventory(sourceRoot);
  await cp(sourceRoot, target, { recursive: true, errorOnExist: true, force: false });
  const copiedHash = await cacheInventory(target);
  if (copiedHash !== sourceHash) throw new Error("Offline cache snapshot differs from its source");
  return { inventorySha256: copiedHash, mode: "caller_snapshot" };
}

function validatePackageName(name) {
  if (typeof name !== "string"
    || !/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u.test(name)) {
    throw new Error("Offline install lock contains an invalid package name");
  }
  return name;
}

const STABLE_EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function parseStableExactVersion(version) {
  if (typeof version !== "string") throw new Error("Offline install lock package versions must be stable exact versions");
  const match = STABLE_EXACT_VERSION.exec(version);
  if (!match) {
    if (/^\d+\.\d+\.\d+-/u.test(version)) {
      throw new Error("Offline install lock prerelease package versions are unsupported");
    }
    throw new Error("Offline install lock package versions must be stable exact versions");
  }
  const components = match.slice(1).map(Number);
  if (components.some((component) => !Number.isSafeInteger(component))) {
    throw new Error("Offline install lock package version exceeds the supported numeric bound");
  }
  return components;
}

function validateExactVersion(version) {
  parseStableExactVersion(version);
  return version;
}

function parseAuthoredDependencySpec(spec) {
  if (typeof spec !== "string") throw new Error("Offline install lock contains an unsupported dependency spec");
  const caret = spec.startsWith("^");
  const versionText = caret ? spec.slice(1) : spec;
  if (/^\d+\.\d+\.\d+-/u.test(versionText)) {
    throw new Error("Offline install lock prerelease dependency specs are unsupported");
  }
  if (!STABLE_EXACT_VERSION.test(versionText)) {
    throw new Error("Offline install lock contains an unsupported dependency spec");
  }
  const lower = parseStableExactVersion(versionText);
  if (!caret) return { kind: "exact", lower, upper: lower };
  const [major, minor, patch] = lower;
  const upper = major > 0
    ? [major + 1, 0, 0]
    : minor > 0
      ? [0, minor + 1, 0]
      : [0, 0, patch + 1];
  if (upper.some((component) => !Number.isSafeInteger(component))) {
    throw new Error("Offline install lock dependency spec exceeds the supported numeric bound");
  }
  return { kind: "caret", lower, upper };
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function versionSatisfiesSpec(version, spec) {
  const candidate = parseStableExactVersion(version);
  const parsed = parseAuthoredDependencySpec(spec);
  if (parsed.kind === "exact") return compareVersions(candidate, parsed.lower) === 0;
  return compareVersions(candidate, parsed.lower) >= 0 && compareVersions(candidate, parsed.upper) < 0;
}

function parseLockPackageKey(key) {
  if (typeof key !== "string" || key === "") throw new Error("Offline install lock contains an unsupported package path");
  const segments = key.split("/");
  let index = 0;
  let parentKey = null;
  let currentKey = "";
  let name = null;
  while (index < segments.length) {
    if (segments[index] !== "node_modules") throw new Error("Offline install lock contains an unsupported package path");
    index += 1;
    if (index >= segments.length) throw new Error("Offline install lock contains an unsupported package path");
    if (segments[index].startsWith("@")) {
      if (index + 1 >= segments.length) throw new Error("Offline install lock contains an unsupported package path");
      name = `${segments[index]}/${segments[index + 1]}`;
      index += 2;
    } else {
      name = segments[index];
      index += 1;
    }
    validatePackageName(name);
    parentKey = currentKey === "" ? null : currentKey;
    currentKey = currentKey === "" ? `node_modules/${name}` : `${currentKey}/node_modules/${name}`;
  }
  if (currentKey !== key) throw new Error("Offline install lock contains a non-canonical package path");
  return { key, name, parentKey };
}

function dependencyDeclarations(entry, owner) {
  const declarations = new Map();
  for (const groupName of ["dependencies", "optionalDependencies"]) {
    const group = entry[groupName];
    if (group === undefined) continue;
    assertPlainRecord(group, `${owner} ${groupName}`);
    for (const [name, version] of Object.entries(group)) {
      validatePackageName(name);
      parseAuthoredDependencySpec(version);
      if (declarations.has(name)) {
        throw new Error("Offline install lock contains an ambiguous dependency declaration");
      }
      declarations.set(name, version);
    }
  }
  if (entry.peerDependencies !== undefined) {
    throw new Error("Offline install lock peer dependencies are unsupported");
  }
  return new Map([...declarations.entries()].sort(([left], [right]) => compareText(left, right)));
}

function canonicalRegistryArtifactUrl(name, version) {
  const basename = name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name;
  return `https://registry.npmjs.org/${name}/-/${basename}-${version}.tgz`;
}

function validateRegistryArtifactUrl(resolvedValue, name, version) {
  if (typeof resolvedValue !== "string") throw new Error("Offline install lock registry package has an invalid URL");
  let resolved;
  try {
    resolved = new URL(resolvedValue);
  } catch {
    throw new Error("Offline install lock registry package has an invalid URL");
  }
  const decodedSegments = resolved.pathname.split("/").slice(1).map((segment) => {
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error("Offline install lock registry package has a malformed encoded path");
    }
    if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) {
      throw new Error("Offline install lock registry package has an unsafe encoded path");
    }
    return decoded;
  });
  const expected = canonicalRegistryArtifactUrl(name, version);
  const expectedPath = new URL(expected).pathname.split("/").slice(1);
  if (resolved.origin !== "https://registry.npmjs.org"
    || resolved.username !== ""
    || resolved.password !== ""
    || resolved.search !== ""
    || resolved.hash !== ""
    || canonicalStringify(decodedSegments) !== canonicalStringify(expectedPath)
    || resolvedValue !== expected) {
    throw new Error("Offline install lock registry package must use its canonical npm registry artifact URL");
  }
}

function resolveLockedDependency(packages, packageMetadata, ownerKey, name, requestedSpec) {
  const validateResolution = (candidate) => {
    const resolvedVersion = packages[candidate].version;
    if (!versionSatisfiesSpec(resolvedVersion, requestedSpec)) {
      throw new Error("Offline install lock resolved version does not satisfy authored dependency spec");
    }
    return candidate;
  };
  let ancestor = ownerKey;
  while (ancestor !== null) {
    const candidate = `${ancestor}/node_modules/${name}`;
    if (packages[candidate] !== undefined) {
      return validateResolution(candidate);
    }
    ancestor = packageMetadata.get(ancestor)?.parentKey ?? null;
  }
  const hoisted = `node_modules/${name}`;
  if (packages[hoisted] !== undefined) {
    return validateResolution(hoisted);
  }
  throw new Error("Offline install lock dependency graph contains a missing or misplaced dependency");
}

async function prepareOfflineInstallLock({ source, target, tarballPath, packageJson }) {
  if (typeof source !== "string" || source.length === 0) {
    throw new TypeError("offlineInstallLockSource must be an explicit non-empty path");
  }
  let sourcePath;
  try {
    sourcePath = await realpath(source);
  } catch {
    throw new Error("Offline install lock source unavailable");
  }
  if (!(await stat(sourcePath)).isFile()) throw new Error("Offline install lock source must be a regular file");
  const sourceBytes = await readFile(sourcePath);
  if (sourceBytes.length > DEFAULT_MAX_OUTPUT_BYTES) throw new Error("Offline install lock exceeds its size bound");
  let lock;
  try {
    lock = JSON.parse(sourceBytes.toString("utf8"));
  } catch {
    throw new Error("Offline install lock is malformed");
  }
  assertPlainRecord(lock, "offline install lock");
  rejectUnknownKeys(lock, new Set(["name", "version", "lockfileVersion", "requires", "packages"]), "offline install lock");
  if (lock.lockfileVersion !== 3 || lock.requires !== true) throw new Error("Offline install lock must use lockfileVersion 3");
  assertPlainRecord(lock.packages, "offline install lock packages");
  const packageKey = `node_modules/${packageJson.name}`;
  validatePackageName(packageJson.name);
  const root = lock.packages[""];
  const localPackage = lock.packages[packageKey];
  assertPlainRecord(root, "offline install lock root");
  assertPlainRecord(localPackage, "offline install lock local package");
  const rootDependencies = root.dependencies;
  if (root.name !== "visp-compatibility-install"
    || root.private !== true
    || canonicalStringify(rootDependencies) !== canonicalStringify({ [packageJson.name]: LOCAL_TARBALL_PLACEHOLDER })) {
    throw new Error("Offline install lock root must reference only the local tarball placeholder");
  }
  const tarballBytes = await readFile(tarballPath);
  const expectedIntegrity = `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`;
  if (localPackage.version !== packageJson.version
    || localPackage.resolved !== LOCAL_TARBALL_PLACEHOLDER
    || localPackage.integrity !== expectedIntegrity) {
    throw new Error("Offline install lock local package identity does not match the packed tarball");
  }
  let lockedBins;
  try {
    lockedBins = normalizeBins({ name: packageJson.name, bin: localPackage.bin });
  } catch {
    throw new Error("Offline install lock local package bin metadata is malformed");
  }
  if (canonicalStringify(lockedBins) !== canonicalStringify(normalizeBins(packageJson))) {
    throw new Error("Offline install lock local package bin metadata does not match the packed tarball");
  }
  for (const groupName of ["dependencies", "optionalDependencies"]) {
    if (canonicalStringify(localPackage[groupName] ?? {}) !== canonicalStringify(packageJson[groupName] ?? {})) {
      throw new Error("Offline install lock does not match packed package dependencies");
    }
  }
  const packageMetadata = new Map();
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === "") continue;
    const metadata = parseLockPackageKey(key);
    assertPlainRecord(entry, `offline install lock package ${key}`);
    validateExactVersion(entry.version);
    if (typeof entry.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(entry.integrity)) {
      throw new Error("Offline install lock registry package is not exact and integrity-pinned");
    }
    if (key !== packageKey) validateRegistryArtifactUrl(entry.resolved, metadata.name, entry.version);
    packageMetadata.set(key, metadata);
  }
  const visited = new Set();
  const queue = [packageKey];
  const edges = [];
  while (queue.length > 0) {
    const ownerKey = queue.shift();
    if (visited.has(ownerKey)) continue;
    const owner = lock.packages[ownerKey];
    if (owner === undefined) throw new Error("Offline install lock dependency graph is incomplete");
    visited.add(ownerKey);
    for (const [name, requestedSpec] of dependencyDeclarations(owner, ownerKey)) {
      const resolvedKey = resolveLockedDependency(lock.packages, packageMetadata, ownerKey, name, requestedSpec);
      edges.push({
        ownerKey,
        requestedName: name,
        requestedSpec,
        resolvedKey,
        resolvedVersion: lock.packages[resolvedKey].version,
      });
      queue.push(resolvedKey);
    }
  }
  const packageKeys = [...packageMetadata.keys()].sort(compareText);
  const extraneous = packageKeys.filter((key) => !visited.has(key));
  if (extraneous.length > 0) throw new Error("Offline install lock contains an extraneous package entry");
  const graph = packageKeys.map((key) => ({
    dependencies: lock.packages[key].dependencies ?? {},
    integrity: lock.packages[key].integrity,
    key,
    name: packageMetadata.get(key).name,
    optionalDependencies: lock.packages[key].optionalDependencies ?? {},
    version: lock.packages[key].version,
  }));
  edges.sort((left, right) => compareText(canonicalStringify(left), canonicalStringify(right)));
  const materialized = structuredClone(lock);
  materialized.packages[""].dependencies[packageJson.name] = `file:${tarballPath}`;
  materialized.packages[packageKey].resolved = `file:${tarballPath}`;
  await writeFile(target, canonicalStringify(materialized), { flag: "wx", mode: 0o600 });
  const record = {
    edgeSha256: sha256Hex(canonicalStringify(edges)),
    edges,
    graphSha256: sha256Hex(canonicalStringify(graph)),
    packages: [],
    path: "package-lock.json",
    sha256: sha256Hex(sourceBytes),
  };
  Object.defineProperty(record, "graph", { enumerable: false, value: graph });
  return record;
}

async function snapshotOfflineStore(source, target) {
  if (typeof source !== "string" || source.length === 0) {
    throw new TypeError("offlineStoreSource must be an explicit non-empty path");
  }
  let sourceRoot;
  try {
    sourceRoot = await realpath(source);
  } catch {
    throw new Error("Offline package-manager store source unavailable");
  }
  if (!(await stat(sourceRoot)).isDirectory()) throw new Error("Offline package-manager store source must be a directory");
  const sourceInventorySha256 = await cacheInventory(sourceRoot);
  await cp(sourceRoot, target, { recursive: true, errorOnExist: true, force: false });
  const copiedInventorySha256 = await cacheInventory(target);
  if (copiedInventorySha256 !== sourceInventorySha256) {
    throw new Error("Offline package-manager store snapshot differs from its source");
  }
  return { mode: "caller_snapshot", sourceInventorySha256 };
}

function normalizeDependencyTree(name, node) {
  const dependencyGroups = [node.dependencies, node.devDependencies, node.optionalDependencies]
    .filter((group) => group && typeof group === "object");
  const dependencyMap = Object.assign({}, ...dependencyGroups);
  const dependencies = Object.keys(dependencyMap).length > 0
    ? Object.entries(dependencyMap)
      .sort(([left], [right]) => compareText(left, right))
      .map(([dependencyName, dependency]) => normalizeDependencyTree(dependencyName, dependency))
    : [];
  return {
    dependencies,
    name,
    version: typeof node.version === "string" ? node.version : null,
  };
}

function pnpmDependencyMap(node, label) {
  assertPlainRecord(node, label);
  const dependencies = new Map();
  for (const groupName of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const group = node[groupName];
    if (group === undefined) continue;
    assertPlainRecord(group, `${label} ${groupName}`);
    for (const [name, dependency] of Object.entries(group)) {
      validatePackageName(name);
      assertPlainRecord(dependency, `${label} dependency ${name}`);
      if (dependencies.has(name)) {
        throw new Error("Prepared dependency inventory contains a duplicate logical edge");
      }
      dependencies.set(name, dependency);
    }
  }
  return dependencies;
}

function pnpmNodeVersion(node) {
  if (typeof node.version !== "string" || node.version.length === 0 || /[\0\r\n]/u.test(node.version)) {
    throw new Error("Prepared dependency is missing an exact package version");
  }
  return node.version;
}

function validatePnpmNominalPath(nominalPath, fixture) {
  if (typeof nominalPath !== "string" || !path.isAbsolute(nominalPath) || nominalPath.includes("\0")) {
    throw new Error("Prepared dependency has an invalid nominal path");
  }
  const resolvedNominalPath = path.resolve(nominalPath);
  if (!isWithin(fixture, resolvedNominalPath)) {
    throw new Error("Prepared dependency nominal path escapes its snapshot");
  }
  return resolvedNominalPath;
}

async function readPnpmPackageManifest(packageRoot) {
  const manifestPath = path.join(packageRoot, "package.json");
  let metadata;
  try {
    metadata = await lstat(manifestPath);
  } catch {
    throw new Error("Prepared dependency is missing its package manifest");
  }
  if (!metadata.isFile() || metadata.size > DEFAULT_MAX_OUTPUT_BYTES) {
    throw new Error("Prepared dependency package manifest is unsupported");
  }
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assertPlainRecord(manifest, "Prepared dependency package manifest");
  } catch {
    throw new Error("Prepared dependency package manifest is malformed");
  }
  if (typeof manifest.name !== "string"
    || typeof manifest.version !== "string"
    || manifest.name.length === 0
    || manifest.version.length === 0) {
    throw new Error("Prepared dependency package manifest has no exact identity");
  }
  return manifest;
}

function manifestDependencyGroup(manifest, groupName) {
  const group = manifest[groupName];
  if (group === undefined) return {};
  assertPlainRecord(group, `Prepared package manifest ${groupName}`);
  return group;
}

function parsePnpmAuthoredEdge(dependencyName, authoredSpec) {
  if (typeof authoredSpec !== "string"
    || authoredSpec.length === 0
    || authoredSpec !== authoredSpec.trim()
    || /[\0\r\n]/u.test(authoredSpec)) {
    throw new Error("Prepared package manifest contains an unsupported dependency spec");
  }
  if (!authoredSpec.startsWith("npm:")) {
    return { alias: false, authoredSpec, targetName: dependencyName };
  }
  const aliasSpec = authoredSpec.slice("npm:".length);
  const versionSeparator = aliasSpec.lastIndexOf("@");
  if (versionSeparator <= 0 || versionSeparator === aliasSpec.length - 1) {
    throw new Error("Prepared package manifest contains a malformed npm alias");
  }
  const targetName = aliasSpec.slice(0, versionSeparator);
  const targetSpec = aliasSpec.slice(versionSeparator + 1);
  validatePackageName(targetName);
  parseAuthoredDependencySpec(targetSpec);
  return { alias: true, authoredSpec: targetSpec, targetName };
}

function optionalPeerDependency(parentManifest, dependencyName) {
  const metadata = parentManifest.peerDependenciesMeta;
  if (metadata === undefined) return false;
  assertPlainRecord(metadata, "Prepared package manifest peerDependenciesMeta");
  const entry = metadata[dependencyName];
  if (entry === undefined) return false;
  assertPlainRecord(entry, `Prepared package manifest peerDependenciesMeta.${dependencyName}`);
  if (entry.optional !== undefined && typeof entry.optional !== "boolean") {
    throw new Error("Prepared package manifest contains invalid optional peer metadata");
  }
  return entry.optional === true;
}

function classifyPnpmEdge(parentManifest, dependencyName, root) {
  const optional = manifestDependencyGroup(parentManifest, "optionalDependencies");
  const required = manifestDependencyGroup(parentManifest, "dependencies");
  const development = root ? manifestDependencyGroup(parentManifest, "devDependencies") : {};
  const peer = manifestDependencyGroup(parentManifest, "peerDependencies");
  const inOptional = Object.hasOwn(optional, dependencyName);
  const inRequired = Object.hasOwn(required, dependencyName);
  const inDevelopment = Object.hasOwn(development, dependencyName);
  const inPeer = Object.hasOwn(peer, dependencyName);
  if (inOptional) {
    if (inDevelopment
      || inPeer
      || (inRequired && required[dependencyName] !== optional[dependencyName])) {
      throw new Error("Prepared package manifest contains an ambiguous dependency edge");
    }
    return { kind: "optional", ...parsePnpmAuthoredEdge(dependencyName, optional[dependencyName]) };
  }
  const requiredGroups = Number(inRequired) + Number(inDevelopment) + Number(inPeer);
  if (requiredGroups > 1) {
    throw new Error("Prepared package manifest contains an ambiguous dependency edge");
  }
  if (inRequired) {
    return { kind: "required", ...parsePnpmAuthoredEdge(dependencyName, required[dependencyName]) };
  }
  if (inDevelopment) {
    return { kind: "required", ...parsePnpmAuthoredEdge(dependencyName, development[dependencyName]) };
  }
  if (inPeer) {
    return {
      kind: optionalPeerDependency(parentManifest, dependencyName) ? "optional" : "required",
      ...parsePnpmAuthoredEdge(dependencyName, peer[dependencyName]),
    };
  }
  throw new Error("Prepared dependency inventory contains an undeclared logical edge");
}

function parseSkippedPnpmIdentity(identity) {
  if (typeof identity !== "string" || identity.includes("\0") || /[\r\n]/u.test(identity)) {
    throw new Error("Prepared modules state contains an invalid skipped identity");
  }
  const separator = identity.lastIndexOf("@");
  if (separator <= 0 || separator === identity.length - 1) {
    throw new Error("Prepared modules state contains an invalid skipped identity");
  }
  const name = identity.slice(0, separator);
  const version = identity.slice(separator + 1);
  validatePackageName(name);
  if (/\s/u.test(version)) throw new Error("Prepared modules state contains an invalid skipped identity");
  return { identity, name, version };
}

async function readPnpmModulesState(fixture, storeRoot, pinnedManager) {
  const modulesPath = path.join(fixture, "node_modules", ".modules.yaml");
  let metadata;
  try {
    metadata = await lstat(modulesPath);
  } catch {
    throw new Error("Pinned pnpm preparation is missing its modules state");
  }
  if (!metadata.isFile() || metadata.size > DEFAULT_MAX_OUTPUT_BYTES) {
    throw new Error("Pinned pnpm modules state is unsupported");
  }
  let modules;
  try {
    modules = JSON.parse(await readFile(modulesPath, "utf8"));
    assertPlainRecord(modules, "Pinned pnpm modules state");
  } catch {
    throw new Error("Pinned pnpm modules state is malformed");
  }
  if (modules.packageManager !== pinnedManager) {
    throw new Error("Pinned pnpm modules state has a package-manager mismatch");
  }
  try {
    assertPlainRecord(modules.included, "Pinned pnpm modules included state");
  } catch {
    throw new Error("Pinned pnpm modules included state is malformed");
  }
  if (modules.included.dependencies !== true
    || modules.included.devDependencies !== true
    || modules.included.optionalDependencies !== true) {
    throw new Error("Pinned pnpm modules state did not include the complete dependency graph");
  }
  if (typeof modules.storeDir !== "string" || !path.isAbsolute(modules.storeDir) || modules.storeDir.includes("\0")) {
    throw new Error("Pinned pnpm modules state has an invalid store path");
  }
  const lexicalStore = path.resolve(modules.storeDir);
  const confinedStoreRoot = await realpath(storeRoot);
  if (!isWithin(confinedStoreRoot, lexicalStore)) {
    throw new Error("Pinned pnpm modules state references a foreign store");
  }
  let actualStore;
  try {
    actualStore = await realpath(lexicalStore);
  } catch {
    throw new Error("Pinned pnpm modules state references an unavailable store");
  }
  if (!isWithin(confinedStoreRoot, actualStore) || !(await stat(actualStore)).isDirectory()) {
    throw new Error("Pinned pnpm modules state references a foreign store");
  }
  if (!Array.isArray(modules.skipped)) {
    throw new Error("Pinned pnpm modules state has an invalid skipped set");
  }
  const skipped = new Map();
  for (const rawIdentity of modules.skipped) {
    const parsed = parseSkippedPnpmIdentity(rawIdentity);
    if (skipped.has(parsed.identity)) {
      throw new Error("Pinned pnpm modules state contains a duplicate skipped identity");
    }
    skipped.set(parsed.identity, parsed);
  }
  return skipped;
}

function parsePnpmTree(result, label) {
  if (result.stdout.truncated || result.stderr.truncated) {
    throw new Error(`${label} exceeded bounded capture`);
  }
  let rawTree;
  try {
    rawTree = JSON.parse(result.stdout.text);
    if (Array.isArray(rawTree)) {
      if (rawTree.length !== 1) throw new Error("unexpected root count");
      [rawTree] = rawTree;
    }
    assertPlainRecord(rawTree, label);
  } catch {
    throw new Error(`${label} returned malformed JSON`);
  }
  return rawTree;
}

function matchingNoOptionalNode(fullNode, noOptionalNode) {
  if (pnpmNodeVersion(fullNode) !== pnpmNodeVersion(noOptionalNode)
    || fullNode.path !== noOptionalNode.path
    || fullNode.from !== noOptionalNode.from) {
    throw new Error("Full and no-optional dependency inventories contradict");
  }
}

async function normalizePnpmDependencyTree({
  name,
  node,
  noOptionalNode,
  fixture,
  edge,
  logicalPath,
  root,
  skipped,
  absences,
}) {
  assertPlainRecord(node, `Prepared dependency ${name}`);
  validatePackageName(name);
  const version = pnpmNodeVersion(node);
  const nominalPath = validatePnpmNominalPath(node.path, fixture);
  if (noOptionalNode !== null) {
    assertPlainRecord(noOptionalNode, `No-optional dependency ${name}`);
    matchingNoOptionalNode(node, noOptionalNode);
  }

  let nominalMetadata;
  try {
    nominalMetadata = await lstat(nominalPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (root || edge.kind !== "optional") {
      throw new Error("Required prepared dependency is missing");
    }
    if (noOptionalNode !== null) {
      throw new Error("Missing optional dependency remains in the no-optional inventory");
    }
    if (edge.targetName !== name) {
      throw new Error("Missing optional npm aliases are unsupported");
    }
    const identity = `${name}@${version}`;
    if (!skipped.has(identity)) {
      throw new Error("Missing optional dependency is absent from pinned pnpm skipped state");
    }
    absences.push({
      name,
      path: logicalPath,
      source: "pnpm_skipped",
      status: "optional_absent",
      version,
    });
    return null;
  }
  if (!nominalMetadata.isDirectory() && !nominalMetadata.isSymbolicLink()) {
    throw new Error("Prepared dependency nominal path is unsupported");
  }

  let packageRoot;
  try {
    packageRoot = await realpath(nominalPath);
  } catch {
    throw new Error("Prepared dependency path could not be resolved");
  }
  if (!isWithin(fixture, packageRoot)) throw new Error("Prepared dependency resolves outside its snapshot");
  const manifest = await readPnpmPackageManifest(packageRoot);
  const expectedName = root ? name : edge.targetName;
  if ((!root && node.from !== expectedName)
    || manifest.name !== expectedName
    || manifest.version !== version) {
    throw new Error("Prepared dependency inventory identity does not match its installed manifest");
  }
  if (!root && edge.alias && !versionSatisfiesSpec(version, edge.authoredSpec)) {
    throw new Error("Prepared dependency version does not satisfy its authored manifest spec");
  }
  const identity = `${expectedName}@${version}`;
  if (skipped.has(identity)) {
    throw new Error("Installed prepared dependency is listed as skipped");
  }

  const dependencyMap = pnpmDependencyMap(node, `Prepared dependency ${name}`);
  const noOptionalMap = noOptionalNode === null
    ? null
    : pnpmDependencyMap(noOptionalNode, `No-optional dependency ${name}`);
  const dependencies = [];
  for (const [dependencyName, dependency] of [...dependencyMap].sort(([left], [right]) => compareText(left, right))) {
    const childEdge = classifyPnpmEdge(manifest, dependencyName, root);
    const noOptionalDependency = noOptionalMap?.get(dependencyName) ?? null;
    if (childEdge.kind === "optional" && noOptionalDependency !== null) {
      throw new Error(
        `Optional dependency remains in the no-optional inventory: ${logicalPath} -> ${dependencyName}`,
      );
    }
    const normalized = await normalizePnpmDependencyTree({
      name: dependencyName,
      node: dependency,
      noOptionalNode: noOptionalDependency,
      fixture,
      edge: childEdge,
      logicalPath: path.posix.join(logicalPath, "node_modules", dependencyName),
      root: false,
      skipped,
      absences,
    });
    if (normalized !== null) dependencies.push(normalized);
  }
  return { dependencies, name, version };
}

async function installedDependencyTree(npmExecutable, fixture, environment) {
  const result = await runChecked(
    npmExecutable,
    ["ls", "--all", "--json"],
    { cwd: fixture, env: environment },
    "Installed dependency inventory",
  );
  let rawTree;
  try {
    rawTree = JSON.parse(result.stdout.text);
  } catch {
    throw new Error("Installed dependency inventory returned malformed JSON");
  }
  const tree = normalizeDependencyTree(rawTree.name ?? "visp-compatibility-install", rawTree);
  return { sha256: sha256Hex(canonicalStringify(tree)), tree };
}

async function preparedDependencyTree(
  managerExecutable,
  managerName,
  fixture,
  environment,
  { pinnedManager = null, storeRoot = null } = {},
) {
  const args = managerName === "pnpm"
    ? ["list", "--depth", "Infinity", "--json"]
    : ["ls", "--all", "--json"];
  const result = await runChecked(
    managerExecutable,
    args,
    { cwd: fixture, env: environment },
    "Prepared dependency inventory",
  );
  if (managerName !== "pnpm") {
    let rawTree;
    try {
      rawTree = JSON.parse(result.stdout.text);
      if (Array.isArray(rawTree)) {
        if (rawTree.length !== 1) throw new Error("unexpected root count");
        [rawTree] = rawTree;
      }
    } catch {
      throw new Error("Prepared dependency inventory returned malformed JSON");
    }
    const tree = normalizeDependencyTree(rawTree.name ?? "prepared-package", rawTree);
    return { sha256: sha256Hex(canonicalStringify(tree)), tree };
  }

  const rawTree = parsePnpmTree(result, "Prepared dependency inventory");
  const noOptionalResult = await runChecked(
    managerExecutable,
    [...args, "--no-optional"],
    { cwd: fixture, env: environment },
    "Prepared no-optional dependency inventory",
  );
  const noOptionalTree = parsePnpmTree(noOptionalResult, "Prepared no-optional dependency inventory");
  if (typeof rawTree.name !== "string" || typeof noOptionalTree.name !== "string" || rawTree.name !== noOptionalTree.name) {
    throw new Error("Full and no-optional dependency inventory roots contradict");
  }
  const skipped = await readPnpmModulesState(fixture, storeRoot, pinnedManager);
  const absences = [];
  const tree = await normalizePnpmDependencyTree({
    name: rawTree.name,
    node: rawTree,
    noOptionalNode: noOptionalTree,
    fixture,
    edge: null,
    logicalPath: ".",
    root: true,
    skipped,
    absences,
  });
  absences.sort((left, right) => compareText(canonicalStringify(left), canonicalStringify(right)));
  return {
    absenceSha256: sha256Hex(canonicalStringify(absences)),
    absences,
    sha256: sha256Hex(canonicalStringify(tree)),
    tree,
  };
}

function parsePackageManager(packageManager) {
  if (typeof packageManager !== "string") return null;
  const match = /^(npm|pnpm)@([0-9A-Za-z.+-]+)$/u.exec(packageManager);
  if (!match) throw new Error("package.json packageManager must pin npm or pnpm to an exact version");
  return { name: match[1], pinned: packageManager, version: match[2] };
}

async function preparePackageSnapshot({
  snapshotRoot,
  preparationDirectory,
  offlineStoreSource,
  packageManagerCommand,
  npmCommand,
}) {
  const packageJson = JSON.parse(await readFile(path.join(snapshotRoot, "package.json"), "utf8"));
  const declaration = parsePackageManager(packageJson.packageManager);
  if (!declaration) {
    if (offlineStoreSource !== undefined || packageManagerCommand !== undefined) {
      throw new Error("Package preparation inputs require a pinned package.json packageManager");
    }
    return null;
  }
  if (offlineStoreSource === undefined) {
    throw new Error("Pinned package preparation requires a caller-supplied offline store");
  }
  const managerExecutable = await findExecutable(packageManagerCommand ?? declaration.name);
  if (!managerExecutable) throw new Error("Pinned package manager unavailable");
  const npmExecutable = await findExecutable(npmCommand);
  if (!npmExecutable) throw new Error("Package inventory tool unavailable");
  const { absolute: preparation } = await requireOwnedPath(preparationDirectory, "preparationDirectory");
  await mkdir(preparation);
  const storePath = path.join(preparation, "store");
  const store = await snapshotOfflineStore(offlineStoreSource, storePath);
  const environment = await npmEnvironment({
    executables: [managerExecutable, npmExecutable],
    configurationDirectory: path.join(preparation, "config"),
    cacheDirectory: storePath,
    ignoreScripts: true,
  });
  const versionResult = await runChecked(managerExecutable, ["--version"], { env: environment }, "Pinned package-manager version");
  const actualVersion = trimLine(versionResult.stdout);
  if (actualVersion !== declaration.version) {
    throw new Error(
      `Pinned package manager mismatch: expected ${declaration.pinned}, received stdout ${JSON.stringify(actualVersion)} `
      + `and stderr ${JSON.stringify(trimLine(versionResult.stderr))}`,
    );
  }
  const lockfileName = declaration.name === "pnpm" ? "pnpm-lock.yaml" : "package-lock.json";
  const lockfilePath = path.join(snapshotRoot, lockfileName);
  let lockfileBytes;
  try {
    lockfileBytes = await readFile(lockfilePath);
  } catch {
    throw new Error(`Pinned package preparation requires ${lockfileName}`);
  }
  const preparationArgs = declaration.name === "pnpm"
    ? [
      "install",
      "--offline",
      "--frozen-lockfile",
      "--trust-lockfile",
      "--ignore-scripts",
      "--package-import-method",
      "copy",
      "--store-dir",
      storePath,
    ]
    : ["ci", "--offline", "--ignore-scripts", "--include=dev", "--cache", storePath];
  await runChecked(
    managerExecutable,
    preparationArgs,
    { cwd: snapshotRoot, env: environment, timeoutMs: 120_000 },
    "Offline lockfile preparation",
  );
  const record = {
    dependencyTree: await preparedDependencyTree(managerExecutable, declaration.name, snapshotRoot, environment, {
      pinnedManager: declaration.pinned,
      storeRoot: storePath,
    }),
    lifecycleScriptsDisabled: true,
    lockfile: { path: lockfileName, sha256: sha256Hex(lockfileBytes) },
    offline: true,
    store: {
      ...store,
    },
    tool: { name: declaration.name, pinned: declaration.pinned, version: actualVersion },
  };
  Object.defineProperty(record, "executable", { enumerable: false, value: managerExecutable });
  return record;
}

function publicPreparation(preparation) {
  return preparation === null ? null : JSON.parse(canonicalStringify(preparation));
}

async function readPackedManifest(tarballPath) {
  const tarExecutable = await findExecutable("tar");
  if (!tarExecutable) throw new Error("Tar inventory tool unavailable");
  const result = await runChecked(
    tarExecutable,
    ["-xOf", tarballPath, "package/package.json"],
    { maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES },
    "Packed package manifest",
  );
  if (result.stdout.truncated || result.stderr.bytes !== 0) throw new Error("Packed package manifest could not be read faithfully");
  let packageJson;
  try {
    packageJson = JSON.parse(result.stdout.text);
  } catch {
    throw new Error("Packed package manifest is malformed");
  }
  packageIdentity(packageJson);
  return packageJson;
}

async function verifyInstalledLockGraph(fixture, installLock) {
  if (installLock === null) return;
  const packages = [];
  for (const expected of installLock.graph) {
    const packageRoot = path.join(fixture, ...expected.key.split("/"));
    let rootMetadata;
    try {
      rootMetadata = await lstat(packageRoot);
    } catch {
      throw new Error("Installed package identity is missing from the validated lock graph");
    }
    if (!rootMetadata.isDirectory() || !isWithin(fixture, await realpath(packageRoot))) {
      throw new Error("Installed package identity is outside the validated lock graph");
    }
    const manifestPath = path.join(packageRoot, "package.json");
    let manifestMetadata;
    try {
      manifestMetadata = await lstat(manifestPath);
    } catch {
      throw new Error("Installed package identity has no package manifest");
    }
    if (!manifestMetadata.isFile() || manifestMetadata.size > DEFAULT_MAX_OUTPUT_BYTES) {
      throw new Error("Installed package identity manifest is unsupported");
    }
    const manifestBytes = await readFile(manifestPath);
    let manifest;
    try {
      manifest = JSON.parse(manifestBytes.toString("utf8"));
    } catch {
      throw new Error("Installed package identity manifest is malformed");
    }
    if (manifest.name !== expected.name || manifest.version !== expected.version) {
      throw new Error("Installed package identity does not match the validated lock entry");
    }
    for (const groupName of ["dependencies", "optionalDependencies"]) {
      if (canonicalStringify(manifest[groupName] ?? {}) !== canonicalStringify(expected[groupName])) {
        throw new Error("Installed package dependency specs do not match the validated lock entry");
      }
    }
    packages.push({
      integrity: expected.integrity,
      key: expected.key,
      manifestSha256: sha256Hex(manifestBytes),
      name: expected.name,
      version: expected.version,
    });
  }
  installLock.packages = packages;
}

export async function installLocalTarball({
  tarballPath,
  fixtureRoot,
  npmCommand = "npm",
  offlineCacheSource,
  offlineInstallLockSource,
}) {
  const { absolute: tarball } = await requireOwnedPath(tarballPath, "tarballPath");
  const { absolute: fixture } = await requireOwnedPath(fixtureRoot, "fixtureRoot");
  await access(tarball, fsConstants.R_OK);
  const npmExecutable = await findExecutable(npmCommand);
  if (!npmExecutable) throw new Error("Offline installer unavailable");
  await mkdir(fixture, { recursive: false });
  const packedManifest = await readPackedManifest(tarball);
  const localDependency = `file:${tarball}`;
  await writeFile(path.join(fixture, "package.json"), canonicalStringify({
    name: "visp-compatibility-install",
    private: true,
    ...(offlineInstallLockSource === undefined ? {} : { dependencies: { [packedManifest.name]: localDependency } }),
  }));
  const cachePath = path.join(fixture, ".npm-cache");
  const cache = await prepareOfflineCache(offlineCacheSource, cachePath);
  const environment = await npmEnvironment({
    executables: [npmExecutable],
    configurationDirectory: path.join(fixture, ".npm-config"),
    cacheDirectory: cachePath,
    ignoreScripts: true,
  });
  const installLock = offlineInstallLockSource === undefined
    ? null
    : await prepareOfflineInstallLock({
      source: offlineInstallLockSource,
      target: path.join(fixture, "package-lock.json"),
      tarballPath: tarball,
      packageJson: packedManifest,
    });
  const installArguments = installLock === null
    ? [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--omit=dev",
      "--cache",
      cachePath,
      tarball,
    ]
    : [
      "ci",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--omit=dev",
      "--cache",
      cachePath,
    ];
  const result = await runProcess(
    npmExecutable,
    installArguments,
    { cwd: fixture, env: environment, timeoutMs: 60_000 },
  );
  if (result.spawnError) throw new Error("Offline installer unavailable");
  if (result.timedOut || result.exitCode !== 0) {
    const error = new Error("Offline local-tarball install failed");
    error.code = "OFFLINE_INSTALL_FAILED";
    error.observation = result;
    throw error;
  }
  await verifyInstalledLockGraph(fixture, installLock);
  const versionResult = await runChecked(npmExecutable, ["--version"], { env: environment }, "Installer version");
  return {
    bins: await inspectInstalledBins({ fixtureRoot: fixture }),
    cache,
    dependencyTree: await installedDependencyTree(npmExecutable, fixture, environment),
    installLock,
    lifecycleScriptsDisabled: true,
    offline: true,
    tool: { name: "npm", version: trimLine(versionResult.stdout) },
  };
}

export async function runInstalledBin({ fixtureRoot, binName, args = [], timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (typeof binName !== "string" || !/^[A-Za-z0-9._-]+$/.test(binName)) throw new TypeError("binName must be a simple installed bin name");
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) throw new TypeError("args must be an array of strings");
  const fixture = await realpath(fixtureRoot);
  const bins = await inspectInstalledBins({ fixtureRoot: fixture });
  if (!bins.some(({ name }) => name === binName)) throw new Error(`Installed bin not found: ${binName}`);
  const binDirectory = path.join(fixture, "node_modules", ".bin");
  const executable = path.join(binDirectory, binName);
  const ownedRoot = await findOwnedRoot(fixture);
  const result = await runProcess(executable, args, {
    cwd: fixture,
    env: stableEnvironment([process.execPath], binDirectory),
    forbiddenOutputFragments: [ownedRoot],
    timeoutMs,
  });
  if (result.spawnError) {
    const error = new Error("Installed binary could not be executed");
    error.code = "EXECUTION_SPAWN_FAILED";
    throw error;
  }
  if (result.forbiddenOutputDetected) {
    const error = new Error("Execution output contains a laboratory-owned temporary path");
    error.code = "UNSTABLE_EXECUTION_OUTPUT";
    error.observation = result;
    throw error;
  }
  return result;
}

function validateExpectations(expectations) {
  assertPlainRecord(expectations, "expectations");
  rejectUnknownKeys(expectations, new Set(["package", "execution"]), "expectations");
  if (expectations.package !== undefined) {
    assertPlainRecord(expectations.package, "expectations.package");
    rejectUnknownKeys(expectations.package, new Set(["name", "version", "bins"]), "expectations.package");
    for (const key of ["name", "version"]) {
      if (expectations.package[key] !== undefined && typeof expectations.package[key] !== "string") {
        throw new TypeError(`expectations.package.${key} must be a string`);
      }
    }
    if (expectations.package.bins !== undefined && (!Array.isArray(expectations.package.bins) || expectations.package.bins.some((item) => typeof item !== "string"))) {
      throw new TypeError("expectations.package.bins must be an array of strings");
    }
  }
  if (expectations.execution !== undefined) {
    assertPlainRecord(expectations.execution, "expectations.execution");
    rejectUnknownKeys(expectations.execution, new Set(["bin", "args", "exitCode", "stdout", "stderr"]), "expectations.execution");
    if (typeof expectations.execution.bin !== "string") throw new TypeError("expectations.execution.bin must be a string");
    if (!Array.isArray(expectations.execution.args) || expectations.execution.args.some((item) => typeof item !== "string")) {
      throw new TypeError("expectations.execution.args must be an array of strings");
    }
    if (!Number.isInteger(expectations.execution.exitCode)) throw new TypeError("expectations.execution.exitCode must be an integer");
    for (const key of ["stdout", "stderr"]) {
      if (expectations.execution[key] !== undefined && typeof expectations.execution[key] !== "string") {
        throw new TypeError(`expectations.execution.${key} must be a string`);
      }
    }
  }
  return structuredClone(expectations);
}

function addAssertion(assertions, id, expected, observed) {
  assertions.push({ expected, id, observed, passed: canonicalStringify(expected) === canonicalStringify(observed) });
}

async function environmentObservation(packToolVersion) {
  const [gitResult, pnpmResult] = await Promise.all([
    runChecked("git", ["--version"], {}, "Git version"),
    runChecked("pnpm", ["--version"], {}, "pnpm version"),
  ]);
  return {
    architecture: process.arch,
    git: trimLine(gitResult.stdout),
    node: process.version,
    operatingSystem: process.platform,
    packTool: { name: "npm", version: packToolVersion },
    pnpm: trimLine(pnpmResult.stdout),
  };
}

function publicPackObservation(pack) {
  return {
    byteSize: pack.byteSize,
    memberListBytes: pack.memberListBytes,
    memberListSha256: pack.memberListSha256,
    members: pack.members,
    package: pack.package,
    sha256: pack.sha256,
    tool: pack.tool,
  };
}

export async function runCompatibilityLab(input) {
  assertPlainRecord(input, "input");
  rejectUnknownKeys(
    input,
    new Set([
      "repositoryRoot",
      "commit",
      "expectations",
      "keepOwnedRoot",
      "offlineCacheSource",
      "offlineInstallLockSource",
      "offlineStoreSource",
      "packageManagerCommand",
    ]),
    "input",
  );
  const expectations = validateExpectations(input.expectations ?? {});
  if (input.keepOwnedRoot !== undefined && typeof input.keepOwnedRoot !== "boolean") {
    throw new TypeError("keepOwnedRoot must be a boolean");
  }
  if (typeof input.commit !== "string" || !/^[0-9a-f]{40}$/.test(input.commit)) {
    throw new TypeError("commit must be a full 40-character lowercase hexadecimal ID");
  }

  const owned = await createOwnedRoot();
  let result;
  try {
    const packed = await packPackageTwice({
      repositoryRoot: input.repositoryRoot,
      commit: input.commit,
      ownedRoot: owned.root,
      offlineStoreSource: input.offlineStoreSource,
      packageManagerCommand: input.packageManagerCommand,
    });
    const fixture = path.join(owned.root, "install");
    const installed = await installLocalTarball({
      tarballPath: packed.tarballPath,
      fixtureRoot: fixture,
      offlineCacheSource: input.offlineCacheSource,
      offlineInstallLockSource: input.offlineInstallLockSource,
    });
    const execution = expectations.execution
      ? await runInstalledBin({
        fixtureRoot: fixture,
        binName: expectations.execution.bin,
        args: expectations.execution.args,
      })
      : null;
    const assertions = [];
    if (expectations.package?.name !== undefined) addAssertion(assertions, "package_name", expectations.package.name, packed.package.name);
    if (expectations.package?.version !== undefined) addAssertion(assertions, "package_version", expectations.package.version, packed.package.version);
    if (expectations.package?.bins !== undefined) {
      addAssertion(assertions, "declared_bins", [...expectations.package.bins].sort(), packed.package.declaredBins.map(({ name }) => name));
    }
    if (expectations.execution) {
      addAssertion(assertions, "execution_exit_code", expectations.execution.exitCode, execution.exitCode);
      if (expectations.execution.stdout !== undefined) addAssertion(assertions, "execution_stdout", expectations.execution.stdout, execution.stdout.text);
      if (expectations.execution.stderr !== undefined) addAssertion(assertions, "execution_stderr", expectations.execution.stderr, execution.stderr.text);
    }
    const passed = assertions.filter(({ passed: assertionPassed }) => assertionPassed).length;
    result = {
      assertions,
      expectations,
      observations: {
        environment: await environmentObservation(packed.first.tool.version),
        execution,
        install: installed,
        package: packed.package,
        preparations: packed.preparations,
        packs: {
          byteEquality: true,
          first: publicPackObservation(packed.first),
          second: publicPackObservation(packed.second),
        },
        source: { commit: packed.commit, tree: packed.tree },
      },
      schemaVersion: "visp.compatibility-lab.observation.v1",
      summary: {
        assertions_passed: passed === assertions.length,
        failed: assertions.length - passed,
        passed,
      },
    };
    await writeFile(path.join(owned.root, "observation.json"), canonicalStringify(result), { flag: "wx" });
    if (input.keepOwnedRoot === true) {
      Object.defineProperty(result, "retainedRoot", { enumerable: false, value: owned.root });
    }
    return result;
  } catch (error) {
    if (input.keepOwnedRoot === true) {
      Object.defineProperty(error, "retainedRoot", { enumerable: false, value: owned.root });
    }
    throw error;
  } finally {
    await cleanupOwnedRoot({ root: owned.root, keep: input.keepOwnedRoot === true });
  }
}
