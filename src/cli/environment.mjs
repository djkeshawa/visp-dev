/**
 * What is actually on this machine, established by running it.
 *
 * Nothing here reads a package directory or a registry. A version is a fact
 * only when the binary printed it, because that is the same resolution a user's
 * shell performs.
 */
import process from "node:process";

import { runProcess } from "../toolchain/process.mjs";

/** A tool's version string, or null when the tool is absent or unreadable. */
export async function detectTool(command, args = ["--version"]) {
  const result = await runProcess(command, args, { timeoutMs: 15_000 });

  if (result.spawnError || result.timedOut || result.exitCode !== 0) return null;

  // runProcess captures stdout as { bytes, sha256, text }, not a bare string.
  const text = `${result.stdout?.text ?? ""}`.trim();

  return text.length > 0 ? text.split("\n")[0].trim() : null;
}

export async function collectEnvironment(projectPath) {
  const [node, npm, pnpm, git, kitRenamed, kitLegacy, hyper] = await Promise.all([
    Promise.resolve(process.version),
    detectTool("npm"),
    detectTool("pnpm"),
    detectTool("git"),
    // P10-US-04: Kit's binary is `visp-kit` from 0.4.0; `visp` is the
    // pre-rename Kit (or, post-cutover, the Hyper dispatcher — which is why
    // the renamed probe wins when both answer).
    detectTool("visp-kit"),
    detectTool("visp"),
    detectTool("visp-hyper")
  ]);

  // The `visp` fallback is only Kit on a PRE-RENAME machine.
  //
  // This used to read `kitRenamed ?? kitLegacy`, which was right until D-118
  // moved Kit to `visp-kit` and gave `visp` to Hyper. After that, a machine
  // with only the coordinator installed made the fallback find Hyper and report
  // its version as Kit's — doctor announcing an engine that is not there, and
  // then computing every recommendation from that invented fact. Doctor's whole
  // job is saying what is installed, so inventing a product is worse than
  // saying nothing: the user stops looking for the real problem.
  //
  // Dropping the fallback outright would be the other kind of wrong. Users on
  // Kit 0.2.3 still have a `visp` that genuinely IS Kit, and they are exactly
  // the people who need doctor to work.
  //
  // Neither binary names itself in `--version` (both print a bare number), so
  // identity comes from the one unambiguous name in the pair: `visp-hyper` is
  // Hyper and nothing else. Hyper ships both binaries from one package, so a
  // `visp` reporting the same version as `visp-hyper` IS that dispatcher.
  //
  // Residual edge, stated rather than hidden: a legacy Kit whose version string
  // happened to equal the installed Hyper's would be read as Hyper and reported
  // absent. That errs toward under-reporting — doctor would advise installing
  // something already present, which is harmless — rather than toward the
  // failure being fixed here, which asserts a product exists when it does not.
  const legacyIsHyperDispatcher = kitLegacy !== null && hyper !== null && kitLegacy === hyper;
  const kit = kitRenamed ?? (legacyIsHyperDispatcher ? null : kitLegacy);

  const insideWorkTree = await runProcess("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: projectPath,
    timeoutMs: 15_000
  });
  const gitRepository = `${insideWorkTree.stdout?.text ?? ""}`.trim() === "true";

  return { node, npm, pnpm, git, kit, hyper, gitRepository };
}

export function nodeSatisfies(version, range) {
  // The matrix only ever expresses a floor, so a full semver range parser would
  // be more machinery than the data justifies.
  const required = Number.parseInt(`${range}`.replace(/^\D*/u, ""), 10);
  const actual = Number.parseInt(`${version}`.replace(/^v/u, ""), 10);

  return Number.isFinite(required) && Number.isFinite(actual) ? actual >= required : null;
}
