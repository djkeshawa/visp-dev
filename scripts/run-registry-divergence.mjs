#!/usr/bin/env node
/**
 * Measures how the published packages differ from local packs declaring the
 * same version. Read-only against the registry.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  canonicalStringify,
  createOwnedRoot,
  cleanupOwnedRoot,
  packPackageTwice,
  runProcess,
  sha256Hex
} from "../src/compatibility-lab.mjs";
import {
  createDivergenceReport,
  measureDivergence,
  verifyDivergenceReport
} from "../src/registry-divergence.mjs";

function parseArguments(argv) {
  const input = { targets: [] };
  let outputPath = null;
  let verifyPath = null;

  const take = (index, flag) => {
    if (index + 1 >= argv.length) throw new TypeError(`${flag} requires a value`);
    return argv[index + 1];
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];

    if (flag === "--repository") {
      // --repository <name>=<path>
      const value = take(index++, flag);
      const [name, repositoryPath] = value.split("=");
      if (name === undefined || repositoryPath === undefined) {
        throw new TypeError("--repository expects <name>=<path>");
      }
      input.targets.push({ name, repositoryPath });
    } else if (flag === "--offline-store") input.offlineStoreSource = take(index++, flag);
    else if (flag === "--package-manager") input.packageManagerCommand = take(index++, flag);
    else if (flag === "--npm") input.npmCommand = take(index++, flag);
    else if (flag === "--output") outputPath = take(index++, flag);
    else if (flag === "--verify") verifyPath = take(index++, flag);
    else throw new TypeError(`Unknown argument: ${flag}`);
  }

  if (verifyPath !== null) return { mode: "verify", verifyPath };

  if (input.targets.length === 0) throw new TypeError("At least one --repository is required");

  for (const field of ["offlineStoreSource", "packageManagerCommand", "npmCommand"]) {
    if (!input[field]) throw new TypeError(`Missing required argument: ${field}`);
  }

  return { input, mode: "run", outputPath };
}

try {
  const parsed = parseArguments(process.argv.slice(2));
  let report;

  if (parsed.mode === "verify") {
    report = JSON.parse(await readFile(parsed.verifyPath, "utf8"));
    verifyDivergenceReport(report);
  } else {
    const owned = await createOwnedRoot();

    try {
      const packages = [];

      for (const target of parsed.input.targets) {
        const packageRoot = await createOwnedRoot({ baseDirectory: owned.root });
        const manifest = JSON.parse(
          await readFile(path.join(target.repositoryPath, "package.json"), "utf8")
        );
        const headResult = await runProcess(
          "git",
          ["-C", target.repositoryPath, "rev-parse", "HEAD"],
          { timeoutMs: 15_000 }
        );
        if (headResult.spawnError || headResult.timedOut || headResult.exitCode !== 0) {
          throw new Error(`Could not resolve ${target.name} HEAD`);
        }
        const head = headResult.stdout.text.trim();
        try {
          const preparation =
            typeof manifest.packageManager === "string"
              ? {
                  offlineStoreSource: parsed.input.offlineStoreSource,
                  packageManagerCommand: parsed.input.packageManagerCommand
                }
              : {};
          const packed = await packPackageTwice({
            repositoryRoot: target.repositoryPath,
            commit: head,
            ownedRoot: packageRoot.root,
            ...preparation,
            npmCommand: parsed.input.npmCommand
          });

          packages.push({
            ...(await measureDivergence({
              packageName: manifest.name,
              version: manifest.version,
              localTarball: packed.tarballPath,
              npmCommand: parsed.input.npmCommand
            })),
            localCommit: head,
            scratchRootSha256: sha256Hex(packageRoot.root)
          });
        } finally {
          await cleanupOwnedRoot({ root: packageRoot.root });
        }
      }

      report = createDivergenceReport({ packages });

      if (parsed.outputPath !== null) {
        await writeFile(parsed.outputPath, canonicalStringify(report), { flag: "wx", mode: 0o600 });
      }
    } finally {
      await cleanupOwnedRoot({ root: owned.root });
    }
  }

  process.stdout.write(`${canonicalStringify(report)}\n`);
} catch (error) {
  process.stderr.write(`registry-divergence: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
