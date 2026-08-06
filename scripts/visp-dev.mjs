#!/usr/bin/env node
import process from "node:process";

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  doctor,
  formatDoctor,
  formatInit,
  formatVersions,
  init,
  versions
} from "../src/cli.mjs";

const USAGE = `visp-dev — setup, diagnostics, and compatibility for Visp

Usage:
  visp-dev doctor   [--project <path>] [--json]
  visp-dev init     [--project <path>] [--json]
  visp-dev versions [--project <path>] [--json]
  visp-dev --version

visp-dev reports state and tells you the exact next command. It decides no
gate and computes no evidence; Visp Kit owns all of that.
`;

function parse(argv) {
  const [command, ...rest] = argv;
  let projectPath = process.cwd();
  let json = false;

  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--json") json = true;
    else if (rest[index] === "--project") {
      projectPath = rest[index + 1];
      index += 1;
      if (projectPath === undefined) throw new TypeError("--project requires a path");
    } else throw new TypeError(`Unknown argument: ${rest[index]}`);
  }

  return { command, projectPath, json };
}

try {
  const { command, projectPath, json } = parse(process.argv.slice(2));

  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  // Every sibling answers --version, and visp-dev's own doctor reports the
  // versions of the others — so being the one binary that cannot state its own
  // was a gap a weak-model evaluation hit immediately.
  if (command === "--version" || command === "-v") {
    const here = dirname(fileURLToPath(import.meta.url));
    const manifest = JSON.parse(await readFile(join(here, "..", "package.json"), "utf8"));
    process.stdout.write(`visp-dev ${manifest.version}\n`);
    process.exit(0);
  }

  const run = { doctor, init, versions }[command];

  if (run === undefined) {
    process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
    process.exit(1);
  }

  const result = await run(projectPath);
  const format = { doctor: formatDoctor, init: formatInit, versions: formatVersions }[command];

  process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : `${format(result)}\n`);

  // A blocked environment is reported, not treated as a crash: nothing is
  // published yet, so "you cannot install this" is the correct answer rather
  // than a failure of the command.
  process.exit(result.status === "failed" ? 1 : 0);
} catch (error) {
  process.stderr.write(`visp-dev: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
