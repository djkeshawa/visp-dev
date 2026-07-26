import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const cli = new URL("../scripts/visp-dev.mjs", import.meta.url).pathname;

async function hostileProject(name) {
  const base = await mkdtemp(path.join(tmpdir(), "visp-dev-hostile-"));
  const project = path.join(base, name);

  await mkdir(project, { recursive: true });
  await run("git", ["init", "--quiet"], { cwd: project });

  return { base, project };
}

// Paths with spaces are the classic packaging bug: a quoting mistake anywhere in
// the chain turns one argument into several, and the failure usually surfaces on
// a user's machine rather than a maintainer's.
const HOSTILE_NAMES = ["path with spaces", "with (parens)", "with 'quote'", "with-ünïcøde"];

for (const name of HOSTILE_NAMES) {
  test(`the CLI runs against a project directory named ${JSON.stringify(name)}`, async () => {
    const { base, project } = await hostileProject(name);

    try {
      for (const command of ["doctor", "versions", "init"]) {
        let stdout = "";

        try {
          ({ stdout } = await run("node", [cli, command, "--project", project, "--json"]));
        } catch (error) {
          // doctor and init exit non-zero when a deprecated build is present.
          // That is a finding about the machine, not a failure to handle paths.
          stdout = `${error.stdout ?? ""}`;
          assert.equal(error.code, 1, `${command} exited unexpectedly for ${name}`);
        }

        const parsed = JSON.parse(stdout);
        assert.ok(parsed, `${command} produced no parseable output for ${name}`);
      }
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
}

test("a project path that does not exist is reported, not crashed on", async () => {
  const missing = path.join(tmpdir(), "visp-dev-absent-directory-that-should-not-exist");

  try {
    const { stdout } = await run("node", [cli, "versions", "--project", missing, "--json"]);
    assert.ok(JSON.parse(stdout));
  } catch (error) {
    assert.equal(error.code, 1);
    assert.ok(`${error.stderr ?? ""}`.length > 0, "a failure must explain itself");
  }
});
