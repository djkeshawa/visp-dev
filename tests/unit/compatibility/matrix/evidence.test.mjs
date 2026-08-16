import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { sha256Hex } from "../../../../src/platform/canonical-json.mjs";
import { materializeRuntimeInstallLock } from "../../../../src/toolchain/index.mjs";
import { stableExecutionEvidence } from "../../../../src/compatibility/matrix/evidence.mjs";

test("execution evidence normalizes owned paths before hashing", () => {
  const result = (ownedRoot) => ({
    exitCode: 0,
    signal: null,
    spawnError: null,
    stderr: { bytes: 0, sha256: "0".repeat(64), text: "", truncated: false },
    stdout: {
      bytes: 0,
      sha256: "0".repeat(64),
      text: `project=${ownedRoot}/row/project\n`,
      truncated: false,
    },
    timedOut: false,
  });
  const first = stableExecutionEvidence(result("/tmp/first-random-root"), ["/tmp/first-random-root"]);
  const second = stableExecutionEvidence(result("/tmp/second-random-root"), ["/tmp/second-random-root"]);
  // Two runs in different scratch directories must produce identical evidence,
  // or no two runs of the matrix could ever be compared.
  assert.deepEqual(first, second);
  assert.equal(
    first.stdout.bytes,
    Buffer.byteLength("project=<VISP_MATRIX_OWNED_ROOT>/row/project\n"),
  );
  assert.equal(first.stdout.sha256, sha256Hex("project=<VISP_MATRIX_OWNED_ROOT>/row/project\n"));
});

test("execution evidence refuses an unstable-path list it cannot apply", () => {
  const result = {
    exitCode: 0,
    signal: null,
    spawnError: null,
    stderr: { bytes: 0, sha256: "0".repeat(64), text: "", truncated: false },
    stdout: { bytes: 0, sha256: "0".repeat(64), text: "", truncated: false },
    timedOut: false,
  };
  assert.throws(() => stableExecutionEvidence(result, [""]), /non-empty strings/u);
  assert.throws(() => stableExecutionEvidence(result, "not-an-array"), /non-empty strings/u);
});

// MOVED CODE, TEST STILL HERE. `materializeRuntimeInstallLock` was lifted out of
// the matrix into `src/toolchain/runtime-lock.mjs` by Slice A, which added no
// test for it. Keeping the assertion here rather than dropping it: Slice C
// should move this case to `tests/toolchain/runtime-lock.test.mjs`.
test("one closed runtime lock template materializes exact packed local identity and bins", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "visp matrix lock "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tarballPath = path.join(root, "package.tgz");
  const outputPath = path.join(root, "package-lock.json");
  await writeFile(tarballPath, "packed bytes");
  const result = await materializeRuntimeInstallLock({
    outputPath,
    package: {
      declaredBins: [{ name: "visp", path: "dist/index.js" }],
      name: "visp-kit",
      version: "0.1.1",
    },
    tarballPath,
  });
  const lock = JSON.parse(await readFile(outputPath, "utf8"));
  assert.deepEqual(lock.packages[""].dependencies, {
    "visp-kit": "file:__VISP_LOCAL_TARBALL__",
  });
  assert.deepEqual(lock.packages["node_modules/visp-kit"], {
    bin: { visp: "dist/index.js" },
    dependencies: { commander: "^12.1.0", zod: "^3.25.76" },
    integrity: result.localIntegrity,
    resolved: "file:__VISP_LOCAL_TARBALL__",
    version: "0.1.1",
  });
  assert.match(result.templateSha256, /^[0-9a-f]{64}$/u);
  assert.match(result.materializedSha256, /^[0-9a-f]{64}$/u);
});
