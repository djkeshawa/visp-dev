/**
 * Running a foreign binary and recording exactly what it did.
 *
 * Bounded output, bounded wall time, no shell, and a process group so a child
 * that spawns its own children cannot outlive the timeout.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import process from "node:process";

import { sha256Hex } from "../platform/canonical-json.mjs";
import { plainObject } from "../platform/shape.mjs";

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_KILL_GRACE_MS = 100;
const DEFAULT_FINALIZATION_MS = 250;

export function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function assertPlainRecord(value, label) {
  plainObject(value, label);
}

export function rejectUnknownKeys(record, allowed, label) {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new TypeError(`Unknown ${label} key: ${key}`);
    }
  }
}

export function trimLine(output) {
  return output.text.trim();
}

function validateCommand(command, args) {
  if (typeof command !== "string" || command.length === 0 || command.includes("\0")) {
    throw new TypeError("command must be a non-empty string without NUL bytes");
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    throw new TypeError("args must be an array of strings without NUL bytes");
  }
}

/**
 * Hashes every byte, captures a bounded prefix, and scans across chunk
 * boundaries for forbidden fragments — a temporary root leaking into output
 * would otherwise be missed whenever it straddled two reads.
 */
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

/**
 * Names to try for a bare command, most specific first.
 *
 * On Windows an executable on PATH is `git.exe` or `npm.cmd`, never `git` or
 * `npm`. Searching for the bare name found nothing, so every test that shells
 * out reported the tool as unavailable — which reads as a broken environment
 * rather than an unported path resolver.
 *
 * PATHEXT is the platform's own answer to which suffixes are executable, so it
 * is read rather than hardcoded.
 *
 * The extensionless name is deliberately NOT probed on win32. `access(X_OK)`
 * is a no-op there, so an extensionless file — npm ships one, a POSIX sh
 * script — reports executable and is then handed to CreateProcess, which
 * cannot run it. Probing extensions only is what visp-hyper-agent's resolver
 * already does. Batch suffixes come last so a real .exe wins.
 */
function executableCandidates(command) {
  if (process.platform !== "win32") return [command];

  const extensions = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const batch = (extension) => /^\.(bat|cmd)$/iu.test(extension);

  return [
    ...extensions.filter((extension) => !batch(extension)),
    ...extensions.filter(batch)
  ].map((extension) => `${command}${extension}`);
}

/** cmd.exe quoting: each token quoted individually, embedded quotes doubled. */
function quoteForCmd(value) {
  return `"${String(value).replace(/"/gu, '""')}"`;
}

/**
 * Resolve a command for THIS platform, and say how it must be spawned.
 *
 * Two Windows facts make this necessary, and neither is visible on Linux:
 *   1. libuv's PATH search tries only `.com` and `.exe` — it does not read
 *      PATHEXT. `spawn("npm")` therefore ENOENTs on a machine where npm is
 *      correctly installed, because npm ships `npm.cmd`, never `npm.exe`.
 *   2. Node refuses to spawn `.cmd`/`.bat` with `shell:false` (the
 *      CVE-2024-27980 mitigation), so a resolved batch shim must go through
 *      cmd.exe with windowsVerbatimArguments rather than be spawned directly.
 *
 * Every npm global install on Windows — visp-kit, visp, visp-hyper,
 * visp-memory — is a `.cmd` shim, so without this `doctor` and `setup` report
 * a fully provisioned machine as empty.
 */
export async function resolveSpawn(command, args) {
  if (process.platform !== "win32") return { file: command, args, verbatim: false };

  const resolved = await findExecutable(command);
  if (resolved === null) return { file: command, args, verbatim: false };
  if (!/\.(bat|cmd)$/iu.test(resolved)) return { file: resolved, args, verbatim: false };

  const comSpec = process.env.ComSpec ?? "cmd.exe";
  const line = [resolved, ...args].map(quoteForCmd).join(" ");
  return { file: comSpec, args: ["/d", "/s", "/c", `"${line}"`], verbatim: true };
}

export async function findExecutable(command) {
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
    for (const candidateName of executableCandidates(command)) {
      const candidate = path.join(directory, candidateName);
      try {
        await access(candidate, fsConstants.X_OK);
        return path.resolve(candidate);
      } catch {
        // Continue searching the explicit PATH entries.
      }
    }
  }
  return null;
}

/**
 * The environment a measured run gets: fixed locale, fixed timezone, and a
 * PATH built only from directories the caller named. Inheriting the ambient
 * environment would make every observation a fact about the machine.
 */
export function stableEnvironment(executables, binDirectory = null) {
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

export async function runProcess(command, args, options = {}) {
  validateCommand(command, args);
  assertPlainRecord(options, "options");
  rejectUnknownKeys(
    options,
    new Set(["cwd", "env", "timeoutMs", "maxOutputBytes", "killGraceMs", "finalizationMs", "forbiddenOutputFragments", "stdin", "windowsVerbatimArguments"]),
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

  // Resolved BEFORE the executor, which cannot await. On non-win32 this is the
  // identity, so the POSIX path is byte-for-byte unchanged.
  const spawnPlan = await resolveSpawn(command, args);

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
      child = spawn(spawnPlan.file, spawnPlan.args, {
        cwd: options.cwd,
        env: options.env,
        detached: useProcessGroup,
        shell: false,
        stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        windowsHide: true,
        ...(spawnPlan.verbatim ? { windowsVerbatimArguments: true } : {}),
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

/** `runProcess`, but a non-zero exit, a timeout or a spawn failure throws. */
export async function runChecked(command, args, options, label) {
  const result = await runProcess(command, args, options);
  if (result.spawnError || result.timedOut || result.exitCode !== 0) {
    const error = new Error(`${label} failed`);
    error.code = "PROCESS_FAILED";
    error.observation = result;
    throw error;
  }
  return result;
}

/**
 * A long-running measured invocation. 120 s, because scaffolding a real Kit
 * project through several commands does not fit the 30 s default.
 */
export async function runExact(command, args, { cwd, env, stdin } = {}) {
  return runProcess(command, args, {
    cwd,
    env,
    ...(stdin === undefined ? {} : { stdin }),
    timeoutMs: 120_000,
  });
}

/** Assert a clean exit and carry the observation on the thrown error. */
export function requireZero(result, label) {
  if (result.spawnError || result.timedOut || result.exitCode !== 0) {
    const error = new Error(`${label} failed`);
    error.observation = result;
    throw error;
  }
  return result;
}
