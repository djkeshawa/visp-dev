/**
 * The command line, and the binary that consumes it.
 *
 * `visp-dev --version` did not exist while every sibling had one and this
 * tool's own doctor reported the versions of the others. A weak-model
 * evaluation hit that immediately, so both spellings are pinned here.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { USAGE, parse } from "../../../src/cli/argv.mjs";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const BIN = join(here, "..", "..", "..", "scripts", "visp-dev.mjs");

test("visp-dev reports its own version", async () => {
  const { stdout } = await execFileAsync(process.execPath, [BIN, "--version"]);
  assert.match(
    stdout.trim(),
    /^visp-dev \d+\.\d+\.\d+/u,
    `--version printed: ${stdout.trim()}`
  );
});

test("-v is accepted as well", async () => {
  const { stdout } = await execFileAsync(process.execPath, [BIN, "-v"]);
  assert.match(stdout.trim(), /^visp-dev \d+\.\d+\.\d+/u);
});

test("the command and its flags are read exactly as written", () => {
  assert.equal(parse(["doctor"]).command, "doctor");
  assert.equal(parse(["doctor"]).json, false);
  assert.equal(parse(["doctor", "--json"]).json, true);
  assert.equal(parse(["versions", "--project", "/tmp/x"]).projectPath, "/tmp/x");
  assert.equal(parse(["versions", "--project", "/tmp/x", "--json"]).json, true);
  // A path that looks like a flag is still a path: `--project` consumes the
  // next token whatever it is, rather than silently falling back to cwd.
  assert.equal(parse(["init", "--project", "--json"]).projectPath, "--json");
});

test("an unknown argument is refused rather than ignored", () => {
  // An ignored flag is a user believing they asked for something. Every
  // unrecognised token has to stop the run and name itself.
  assert.throws(() => parse(["doctor", "--verbose"]), /Unknown argument: --verbose/u);
  assert.throws(() => parse(["doctor", "-x"]), /Unknown argument: -x/u);
  assert.throws(() => parse(["doctor", "--project"]), /--project requires a path/u);
});

test("no command at all is not an error; it is the help request", () => {
  assert.equal(parse([]).command, undefined);
});

test("the usage text promises the exact next command, which is the product claim", () => {
  assert.match(USAGE, /visp-dev doctor/u);
  assert.match(USAGE, /visp-dev init/u);
  assert.match(USAGE, /visp-dev versions/u);
  assert.match(USAGE, /the exact next command/u);
  // It must keep disclaiming authority: Kit decides, this reports.
  assert.match(USAGE, /decides no\ngate and computes no evidence/u);
});

test("an unknown command exits non-zero and prints the usage", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [BIN, "not-a-command"]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(`${error.stderr}`, /Unknown command: not-a-command/u);
      assert.match(`${error.stderr}`, /visp-dev doctor/u);
      return true;
    }
  );
});

test("--help prints the usage and exits zero", async () => {
  const { stdout } = await execFileAsync(process.execPath, [BIN, "--help"]);
  assert.equal(stdout, USAGE);
});
