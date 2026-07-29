import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
// `new URL(...).pathname` yields `/D:/a/visp-dev/...` on Windows — a string node
// cannot resolve — so the CLI never started, stdout was empty, and the test
// blamed JSON.parse for a path bug. A hostile-path suite that cannot itself
// handle a platform's paths proves nothing.
const cli = fileURLToPath(new URL("../scripts/visp-dev.mjs", import.meta.url));

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
          // An exit code alone does not distinguish "reported a finding" from
          // "never started". Both exit 1, and only one of them is the thing
          // under test, so say which happened rather than letting JSON.parse
          // report it as malformed output several lines later.
          assert.notEqual(
            stdout,
            "",
            `${command} exited 1 without output for ${name}; stderr: ${error.stderr ?? ""}`,
          );
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
