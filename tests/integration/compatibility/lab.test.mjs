import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { stat, writeFile } from "node:fs/promises";

import {
  canonicalStringify,
  cleanupOwnedRoot,
  runCompatibilityLab,
} from "../../../src/toolchain/index.mjs";
import {
  execFileAsync,
  git,
  makeToyPackage,
} from "../../helpers/toy-package.mjs";

test("complete laboratory output is canonical, stable, separated, and non-authoritative", async (t) => {
  const toy = await makeToyPackage(t);

  if (toy === null) return;
  const expectations = {
    package: { name: "toy-package", version: "1.2.3", bins: ["toy-command"] },
    execution: {
      bin: "toy-command",
      args: ["stable"],
      exitCode: 0,
      stdout: '{"argv":["stable"],"cwd":"isolated"}\n',
    },
  };
  const input = { repositoryRoot: toy.root, commit: toy.commit, expectations };
  const first = await runCompatibilityLab(input);
  const second = await runCompatibilityLab(input);

  assert.equal(canonicalStringify(first), canonicalStringify(second));
  assert.deepEqual(first.expectations, expectations);
  assert.equal(first.observations.source.commit, toy.commit);
  assert.equal(first.observations.source.tree, toy.tree);
  assert.ok(first.assertions.every(({ passed }) => passed));
  assert.deepEqual(first.summary, { assertions_passed: true, failed: 0, passed: first.assertions.length });

  const rendered = canonicalStringify(first);
  assert.doesNotMatch(rendered, /visp-compatibility-lab-|duration|timestamp/i);
  assert.doesNotMatch(rendered, /verdict|permission|assurance|completion|pr[_ -]?readiness/i);
  assert.equal(rendered.endsWith("\n"), true);
  assert.equal(rendered, canonicalStringify(JSON.parse(rendered)));
});

test("execution output fails closed when full raw bytes contain an owned random path", async (t) => {
  const toy = await makeToyPackage(t, "path-emitting-package");

  if (toy === null) return;
  await writeFile(
    path.join(toy.root, "bin", "toy-command.mjs"),
    "#!/usr/bin/env node\nprocess.stdout.write('x'.repeat(1100000)); process.stdout.write(process.cwd() + '\\n');\n",
    { mode: 0o755 },
  );
  await git(toy.root, ["add", "bin/toy-command.mjs"]);
  await git(toy.root, ["commit", "--quiet", "-m", "emit runtime path"]);
  const { stdout: commitOutput } = await git(toy.root, ["rev-parse", "HEAD"]);
  const input = {
    repositoryRoot: toy.root,
    commit: commitOutput.trim(),
    expectations: { execution: { bin: "toy-command", args: [], exitCode: 0 } },
  };
  const errors = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await runCompatibilityLab(input);
      assert.fail("owned path output must fail closed");
    } catch (error) {
      errors.push({ code: error.code, message: error.message });
    }
  }
  assert.deepEqual(errors[0], errors[1]);
  assert.deepEqual(errors[0], {
    code: "UNSTABLE_EXECUTION_OUTPUT",
    message: "Execution output contains a laboratory-owned temporary path",
  });
  assert.doesNotMatch(canonicalStringify(errors[0]), /visp-compatibility-lab-/i);
});

test("complete laboratory fails stably when an installed bin has a broken interpreter", async (t) => {
  const toy = await makeToyPackage(t, "broken-bin-package");

  if (toy === null) return;
  const missingInterpreter = path.join(toy.root, "missing-interpreter");
  await writeFile(
    path.join(toy.root, "bin", "toy-command.mjs"),
    `#!${missingInterpreter}\nprocess.stdout.write('must not run\\n');\n`,
    { mode: 0o755 },
  );
  await git(toy.root, ["add", "bin/toy-command.mjs"]);
  await git(toy.root, ["commit", "--quiet", "-m", "broken installed bin"]);
  const { stdout: commitOutput } = await git(toy.root, ["rev-parse", "HEAD"]);
  const input = {
    repositoryRoot: toy.root,
    commit: commitOutput.trim(),
    expectations: { execution: { bin: "toy-command", args: [], exitCode: 0 } },
  };
  const failures = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await runCompatibilityLab(input);
      assert.fail("broken interpreter must fail closed");
    } catch (error) {
      failures.push({ code: error.code, message: error.message });
    }
  }
  assert.deepEqual(failures[0], failures[1]);
  assert.deepEqual(failures[0], {
    code: "EXECUTION_SPAWN_FAILED",
    message: "Installed binary could not be executed",
  });
  assert.doesNotMatch(canonicalStringify(failures[0]), /visp-compatibility-lab-|missing-interpreter/i);
});

test("closed input validation rejects unknown keys and malformed expectations", async (t) => {
  const toy = await makeToyPackage(t);

  if (toy === null) return;
  await assert.rejects(
    runCompatibilityLab({ repositoryRoot: toy.root, commit: toy.commit, expectations: {}, extra: true }),
    /unknown input key/i,
  );
  await assert.rejects(
    runCompatibilityLab({ repositoryRoot: toy.root, commit: toy.commit, expectations: { package: { bins: "toy-command" } } }),
    /expectations\.package\.bins/i,
  );
  await assert.rejects(
    runCompatibilityLab({ repositoryRoot: toy.root, commit: toy.commit.slice(0, 8), expectations: {} }),
    /full 40-character/i,
  );
});

test("CLI runs the complete toy-package laboratory and emits one canonical document", async (t) => {
  const toy = await makeToyPackage(t);

  if (toy === null) return;
  const cli = fileURLToPath(new URL("../../../scripts/compatibility/lab.mjs", import.meta.url));
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    cli,
    "--repository",
    toy.root,
    "--commit",
    toy.commit,
    "--expect-package-name",
    "toy-package",
    "--expect-package-version",
    "1.2.3",
    "--expect-bin",
    "toy-command",
    "--run-bin",
    "toy-command",
    "--bin-arg",
    "cli proof ;$()",
    "--expect-stdout",
    '{"argv":["cli proof ;$()"],"cwd":"isolated"}\n',
    "--keep",
  ], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  const retainedMatch = /^compatibility-lab: retained root (.+)\n$/u.exec(stderr);
  assert.ok(retainedMatch);
  const retainedRoot = retainedMatch[1];
  assert.ok(await stat(retainedRoot));
  const document = JSON.parse(stdout);
  assert.equal(document.summary.assertions_passed, true);
  assert.equal(stdout, canonicalStringify(document));
  assert.doesNotMatch(stdout, new RegExp(toy.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  assert.doesNotMatch(stdout, new RegExp(retainedRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  await cleanupOwnedRoot({ root: retainedRoot });
});

test("CLI reports and immediately cleans exact kept roots for concurrent failures", async (t) => {
  const toy = await makeToyPackage(t);

  if (toy === null) return;
  const cli = fileURLToPath(new URL("../../../scripts/compatibility/lab.mjs", import.meta.url));
  const invokeFailure = async () => {
    try {
      await execFileAsync(process.execPath, [
        cli,
        "--repository",
        toy.root,
        "--commit",
        toy.commit,
        "--offline-cache",
        path.join(toy.root, "missing-cache"),
        "--keep",
      ], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
      assert.fail("CLI failure fixture must fail");
    } catch (error) {
      const retainedMatch = /^compatibility-lab: .+\ncompatibility-lab: retained root (.+)\n$/u.exec(error.stderr);
      assert.ok(retainedMatch);
      const retainedRoot = retainedMatch[1];
      try {
        assert.ok(await stat(retainedRoot));
        const document = JSON.parse(error.stdout);
        assert.equal(error.stdout, canonicalStringify(document));
        assert.doesNotMatch(error.stdout, new RegExp(retainedRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      } finally {
        await cleanupOwnedRoot({ root: retainedRoot });
      }
      await assert.rejects(stat(retainedRoot), { code: "ENOENT" });
      return retainedRoot;
    }
  };
  const roots = await Promise.all([invokeFailure(), invokeFailure()]);
  assert.equal(new Set(roots).size, 2);
});
