import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { mkdtemp, rm, stat } from "node:fs/promises";

import {
  runProcess,
  sha256Hex,
} from "../../../src/toolchain/index.mjs";

test("process runner records success, failure, spawn error, timeout, and bounded raw output", async () => {
  const success = await runProcess(process.execPath, ["-e", "process.stdout.write('ok'); process.stderr.write('note')"]);
  assert.equal(success.exitCode, 0);
  assert.equal(success.signal, null);
  assert.equal(success.stdout.text, "ok");
  assert.equal(success.stderr.text, "note");
  assert.equal(success.stdout.sha256, sha256Hex("ok"));

  const standardInput = await runProcess(
    process.execPath,
    ["-e", "process.stdin.pipe(process.stdout)"],
    { stdin: "newline-delimited request\n" },
  );
  assert.equal(standardInput.exitCode, 0);
  assert.equal(standardInput.stdout.text, "newline-delimited request\n");

  const nonzero = await runProcess(process.execPath, ["-e", "process.stderr.write('bad'); process.exit(7)"]);
  assert.equal(nonzero.exitCode, 7);
  assert.equal(nonzero.stderr.text, "bad");

  const missing = await runProcess(path.join(tmpdir(), "definitely missing visp executable"), []);
  assert.equal(missing.exitCode, null);
  assert.equal(missing.spawnError.code, "ENOENT");
  assert.equal(missing.spawnError.message, undefined);
  assert.match(missing.spawnError.messageSha256, /^[0-9a-f]{64}$/);

  const timedOut = await runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 50 });
  assert.equal(timedOut.timedOut, true);
  assert.equal(timedOut.exitCode, null);
  assert.ok(timedOut.signal);

  const bounded = await runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(200000))"], {
    maxOutputBytes: 1024,
  });
  assert.equal(Buffer.byteLength(bounded.stdout.text), 1024);
  assert.equal(bounded.stdout.bytes, 200000);
  assert.equal(bounded.stdout.truncated, true);
  assert.equal(bounded.stdout.sha256, sha256Hex("x".repeat(200000)));
});

test("process timeout terminates descendants that retain stdio within a bounded wall time", async (t) => {
  const markerRoot = await mkdtemp(path.join(tmpdir(), "visp-timeout-marker-"));
  t.after(() => rm(markerRoot, { recursive: true, force: true }));
  const marker = path.join(markerRoot, "descendant-survived");
  const descendant = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'leaked'), 700); setTimeout(() => process.exit(0), 1500);`;
  const parent = `const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'inherit', 'inherit'] }); process.stdout.write(String(child.pid) + '\\n'); setInterval(() => {}, 1000);`;
  const started = performance.now();
  const result = await runProcess(process.execPath, ["-e", parent], { timeoutMs: 50 });
  const elapsedMs = performance.now() - started;
  assert.equal(result.timedOut, true);
  assert.ok(elapsedMs < 600, `timeout returned after ${elapsedMs}ms`);
  await new Promise((resolve) => setTimeout(resolve, 800));
  await assert.rejects(stat(marker), { code: "ENOENT" });
});
