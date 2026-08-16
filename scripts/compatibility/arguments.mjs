/**
 * The argument handling every compatibility entrypoint shares.
 *
 * Fourteen scripts carried a copy of the same loop, and the copies had drifted
 * into three different parsers: one rejected unknown flags, one silently
 * ignored them, and one accepted `--verify` with no value and fell back to a
 * committed path. That last one is why a `--verify` invocation could report PASS
 * without the caller ever naming what was verified. Every entrypoint now parses
 * the same way, and `--verify` always requires an explicit path.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";

import { canonicalStringify } from "../../src/platform/canonical-json.mjs";

/**
 * @param flags     `{ "--kit-repository": "kitRepositoryRoot" }` — value flags
 * @param booleans  `{ "--keep": "keepOwnedRoot" }` — presence flags
 * @param required  input keys that must be present for a run
 */
export function parseArguments(argv, { flags, booleans = {}, required = [], label }) {
  const input = {};
  let outputPath = null;
  let verifyPath = null;
  const takeValue = (index, flag) => {
    if (index + 1 >= argv.length) throw new TypeError(`${flag} requires a value`);
    return argv[index + 1];
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--output") outputPath = takeValue(index++, flag);
    else if (flag === "--verify") verifyPath = takeValue(index++, flag);
    else if (Object.hasOwn(booleans, flag)) input[booleans[flag]] = true;
    else if (Object.hasOwn(flags, flag)) input[flags[flag]] = takeValue(index++, flag);
    else throw new TypeError(`Unknown argument: ${flag}`);
  }

  if (verifyPath !== null) {
    if (Object.keys(input).length !== 0 || outputPath !== null) {
      throw new TypeError("--verify cannot be combined with runner arguments");
    }
    return { mode: "verify", verifyPath };
  }
  for (const field of required) {
    if (input[field] === undefined) throw new TypeError(`Missing required ${label} argument: ${field}`);
  }
  return { input, mode: "run", outputPath };
}

/**
 * Runs or verifies, writes the document, and reports the retained scratch root
 * on both the success and the failure path.
 *
 * The failure path matters more: `--keep` exists so a human can inspect what a
 * FAILED run left behind, and an entrypoint that only printed the root on
 * success threw that away exactly when it was wanted.
 */
export async function entrypoint({
  argv = process.argv.slice(2),
  label,
  errorCode,
  errorSchemaVersion,
  flags,
  booleans,
  required,
  run,
  verify,
  afterRun = null,
}) {
  try {
    const parsed = parseArguments(argv, { booleans, flags, label, required });
    let report;
    if (parsed.mode === "verify") {
      report = JSON.parse(await readFile(parsed.verifyPath, "utf8"));
      verify(report);
    } else {
      report = await run(parsed.input);
      if (parsed.outputPath !== null) {
        // Reports land in reports/, which is gitignored and so absent from a
        // fresh checkout. `wx` still refuses to overwrite an existing report.
        await mkdir(dirname(parsed.outputPath), { recursive: true });
        await writeFile(parsed.outputPath, canonicalStringify(report), { flag: "wx", mode: 0o600 });
      }
    }
    process.stdout.write(canonicalStringify(report));
    if (report.retainedRoot) {
      process.stderr.write(`${label}: retained root ${report.retainedRoot}\n`);
    }
    if (afterRun !== null) afterRun(report, parsed.mode);
  } catch (error) {
    process.stderr.write(`${label}: ${error instanceof Error ? error.message : String(error)}\n`);
    if (error.retainedRoot) {
      process.stderr.write(`${label}: retained root ${error.retainedRoot}\n`);
    }
    if (errorSchemaVersion !== undefined) {
      process.stdout.write(canonicalStringify({
        error: { code: error.code ?? error.name ?? errorCode },
        schemaVersion: errorSchemaVersion,
      }));
    }
    process.exitCode = 1;
  }
}

/** The six paths and commands every packed-pair runner needs. */
export const PAIR_FLAGS = {
  "--kit-repository": "kitRepositoryRoot",
  "--hyper-repository": "hyperRepositoryRoot",
  "--offline-store": "offlineStoreSource",
  "--offline-cache": "offlineCacheSource",
  "--package-manager": "packageManagerCommand",
  "--npm": "npmCommand",
};

export const PAIR_REQUIRED = [
  "kitRepositoryRoot",
  "hyperRepositoryRoot",
  "offlineStoreSource",
  "offlineCacheSource",
  "packageManagerCommand",
  "npmCommand",
];

export const KEEP_FLAG = { "--keep": "keepOwnedRoot" };
