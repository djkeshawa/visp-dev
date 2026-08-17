/**
 * What is actually on this machine, established by running it.
 *
 * Nothing here reads a package directory or a registry. A version is a fact
 * only when the binary printed it, because that is the same resolution a user's
 * shell performs.
 *
 * LC-95: "the same resolution" has to mean the same resolution for BOTH
 * products. Kit was probed under `visp-kit` with a `visp` fallback while Hyper
 * was probed under `visp-hyper` alone, so on a machine whose PATH put a newer
 * Hyper first as `visp`, doctor read Kit off PATH and Hyper off a stale global
 * install — `visp --version` printed 0.9.0 while doctor reported 0.8.0 in the
 * same shell. A compatibility verdict about a different installation than the
 * one in use is worthless, so both products now go through one resolver, the
 * resolved path is recorded next to the version, and PATH order decides the
 * winner exactly as the shell would.
 */
import path from "node:path";
import process from "node:process";

import { findExecutable, runProcess } from "../toolchain/process.mjs";

/** A tool's version string, or null when the tool is absent or unreadable. */
export async function detectTool(command, args = ["--version"]) {
  const result = await runProcess(command, args, { timeoutMs: 15_000 });

  if (result.spawnError || result.timedOut || result.exitCode !== 0) return null;

  // runProcess captures stdout as { bytes, sha256, text }, not a bare string.
  const text = `${result.stdout?.text ?? ""}`.trim();

  return text.length > 0 ? text.split("\n")[0].trim() : null;
}

/**
 * Where `command` resolves on this PATH, which entry supplied it, and what that
 * exact file prints for `--version`.
 *
 * The version is read from the resolved path rather than from the bare name, so
 * the version reported and the path reported can never describe two different
 * files. Returns null when the name is not on PATH at all.
 */
export async function resolveTool(command) {
  const resolved = await findExecutable(command);
  if (resolved === null) return null;

  return {
    command,
    path: resolved,
    pathIndex: pathIndexOf(resolved),
    version: await detectTool(resolved)
  };
}

/**
 * Which PATH entry a resolved file came from. Later entries lose, because that
 * is how the shell picks. A file outside every PATH entry sorts last.
 */
export function pathIndexOf(filePath, pathValue = process.env.PATH ?? "") {
  const directory = path.resolve(path.dirname(filePath));
  const index = pathValue
    .split(path.delimiter)
    .filter(Boolean)
    .map((entry) => path.resolve(entry))
    .indexOf(directory);

  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * Which product the bare `visp` binary belongs to on this machine, or null when
 * nothing can be said.
 *
 * Before D-118 `visp` WAS Kit; after it, Hyper ships `visp` and `visp-hyper`
 * from one package and Kit answers to `visp-kit`. Neither binary names itself
 * in `--version` — both print a bare number — so identity comes from what else
 * is on the machine.
 *
 * Residual edge, stated rather than hidden: a machine carrying `visp-kit`, a
 * stale pre-rename Kit still on `visp`, and a Hyper install would read that
 * stale `visp` as a second Hyper. It is reported as a conflict with both paths
 * printed, which is what makes it visible instead of silently wrong — and the
 * user needs to hear about two Hypers on PATH either way.
 */
function dispatcherOwner(dispatcher, kit, hyper) {
  if (dispatcher === null || dispatcher.version === null) return null;

  if (hyper !== null && hyper.version !== null) {
    // Hyper ships both names from one package, so equal versions settle it.
    if (dispatcher.version === hyper.version) return "hyper";
    // They disagree, so these are two separate installations. Kit answering to
    // its own name means `visp` is not Kit — it is the other Hyper, and being
    // earlier on PATH it is the one the shell runs.
    return kit === null ? "kit" : "hyper";
  }

  // No Hyper anywhere: `visp` is Kit only where Kit has no name of its own.
  return kit === null ? "kit" : null;
}

/** The candidate the shell would run, and every candidate that answered. */
function shellResolution(command, candidates) {
  const answered = candidates
    .filter((candidate) => candidate !== null && candidate.version !== null)
    .sort((left, right) => left.pathIndex - right.pathIndex);
  const winner = answered[0] ?? null;

  return {
    command: winner?.command ?? command,
    path: winner?.path ?? null,
    version: winner?.version ?? null,
    candidates: answered.map(({ command: name, path: file, version }) => ({
      command: name,
      path: file,
      version
    })),
    // Two binaries for one product reporting different versions is the LC-95
    // defect itself. Whichever wins, the user has to be told the other exists.
    conflict: new Set(answered.map((candidate) => candidate.version)).size > 1
  };
}

export async function collectEnvironment(projectPath) {
  const [npm, pnpm, git, kitNamed, hyperNamed, dispatcher] = await Promise.all([
    detectTool("npm"),
    detectTool("pnpm"),
    detectTool("git"),
    // P10-US-04: Kit's binary is `visp-kit` from 0.4.0; `visp` is the
    // pre-rename Kit (or, post-cutover, the Hyper dispatcher).
    resolveTool("visp-kit"),
    resolveTool("visp-hyper"),
    resolveTool("visp")
  ]);

  const owner = dispatcherOwner(dispatcher, kitNamed, hyperNamed);
  const kit = shellResolution("visp-kit", [kitNamed, owner === "kit" ? dispatcher : null]);
  const hyper = shellResolution("visp-hyper", [hyperNamed, owner === "hyper" ? dispatcher : null]);

  const insideWorkTree = await runProcess("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: projectPath,
    timeoutMs: 15_000
  });
  const gitRepository = `${insideWorkTree.stdout?.text ?? ""}`.trim() === "true";

  return {
    node: process.version,
    npm,
    pnpm,
    git,
    kit: kit.version,
    hyper: hyper.version,
    resolved: { kit, hyper },
    gitRepository
  };
}
