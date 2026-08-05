// P10-US-08: the machine-scope adapter. Setup verifies the matched pair and
// registers the MCP host entry under the D-118 file rule: never overwrite a
// user-modified file, never leave a broken state silently.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";

import { runSetup } from "../src/machine-scope.mjs";

// A stand-in binary the platform will actually execute. A POSIX shell script
// is not executable on Windows — chmod is a no-op there and there is no
// shebang support — so these five tests failed on every Windows run since they
// were written. Writing a .cmd instead exercises the real Windows resolution
// path (runProcess tries PATHEXT variants) rather than skipping the question.
async function fakeBinary(dir, name, version) {
  if (process.platform === "win32") {
    const file = join(dir, `${name}.cmd`);
    await writeFile(file, `@echo off\r\necho ${version}\r\n`, "utf8");
    return;
  }
  const file = join(dir, name);
  await writeFile(file, `#!/bin/sh\necho "${version}"\n`, "utf8");
  await chmod(file, 0o755);
}

async function machine(versions) {
  const binDir = await mkdtemp(join(tmpdir(), "visp-dev-bin-"));
  for (const [name, version] of Object.entries(versions)) {
    await fakeBinary(binDir, name, version);
  }
  const projectPath = await mkdtemp(join(tmpdir(), "visp-dev-project-"));
  return { binDir, projectPath };
}

async function withPath(binDir, run) {
  const original = process.env.PATH;
  process.env.PATH = binDir;
  try {
    return await run();
  } finally {
    process.env.PATH = original;
  }
}

test("setup succeeds on a matched pair and registers MCP", async () => {
  const { binDir, projectPath } = await machine({
    "visp-kit": "0.4.0",
    visp: "0.7.0",
    "visp-memory": "0.4.0"
  });

  const result = await withPath(binDir, () => runSetup({ projectPath }));

  assert.equal(result.success, true);
  assert.match(result.report, /visp-kit: 0\.4\.0 — ok/u);
  assert.match(result.report, /visp \(coordinator\): 0\.7\.0 — ok/u);
  assert.match(result.report, /visp-memory: 0\.4\.0 — ok/u);

  const mcp = JSON.parse(await readFile(join(projectPath, ".mcp.json"), "utf8"));
  assert.deepEqual(mcp.mcpServers.visp, { command: "visp", args: ["serve", "--mcp"] });
});

test("setup refuses visibly when the pair is below the floors", async () => {
  const { binDir, projectPath } = await machine({ "visp-kit": "0.3.0", visp: "0.5.0" });

  const result = await withPath(binDir, () => runSetup({ projectPath }));

  assert.equal(result.success, false);
  assert.match(result.report, /below the matched pair floor 0\.4\.0/u);
  assert.match(result.report, /below the matched pair floor 0\.7\.0/u);
  assert.match(result.report, /MCP registration skipped/u);
});

test("absent Memory is reported as optional, not a failure", async () => {
  const { binDir, projectPath } = await machine({ "visp-kit": "0.4.0", visp: "0.7.0" });

  const result = await withPath(binDir, () => runSetup({ projectPath }));

  assert.equal(result.success, true);
  assert.match(result.report, /visp-memory: not installed \(optional\)/u);
});

test("a user-modified visp MCP entry is never overwritten (D-118)", async () => {
  const { binDir, projectPath } = await machine({ "visp-kit": "0.4.0", visp: "0.7.0" });
  const userEntry = { mcpServers: { visp: { command: "my-wrapper", args: ["--custom"] } } };
  await writeFile(join(projectPath, ".mcp.json"), JSON.stringify(userEntry), "utf8");

  const result = await withPath(binDir, () => runSetup({ projectPath }));

  assert.equal(result.success, false);
  assert.match(result.report, /modified visp entry; it was left untouched/u);
  // The user's bytes survive exactly.
  assert.deepEqual(
    JSON.parse(await readFile(join(projectPath, ".mcp.json"), "utf8")),
    userEntry
  );
});

test("an existing .mcp.json without a visp entry is merged, not replaced", async () => {
  const { binDir, projectPath } = await machine({ "visp-kit": "0.4.0", visp: "0.7.0" });
  await writeFile(
    join(projectPath, ".mcp.json"),
    JSON.stringify({ mcpServers: { other: { command: "other-tool" } } }),
    "utf8"
  );

  const result = await withPath(binDir, () => runSetup({ projectPath }));

  assert.equal(result.success, true);
  const merged = JSON.parse(await readFile(join(projectPath, ".mcp.json"), "utf8"));
  assert.deepEqual(merged.mcpServers.other, { command: "other-tool" });
  assert.deepEqual(merged.mcpServers.visp, { command: "visp", args: ["serve", "--mcp"] });
});
