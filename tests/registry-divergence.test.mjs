import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createDivergenceReport, verifyDivergenceReport } from "../src/registry-divergence.mjs";

const run = promisify(execFile);

const evidence = JSON.parse(
  readFileSync(new URL("../evidence/registry-divergence-linux-x64-node24.json", import.meta.url), "utf8")
);

async function createNodeCommandWrapper(base) {
  const script = path.join(base, "node-wrapper.mjs");
  const marker = path.join(base, "forwarded-argv.json");

  await writeFile(
    script,
    `import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
writeFileSync(${JSON.stringify(marker)}, JSON.stringify(args));
const result = spawnSync(${JSON.stringify(process.execPath)}, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
`
  );

  return { command: process.execPath, commandArgs: [script], marker };
}

test("the committed divergence evidence verifies", () => {
  assert.equal(verifyDivergenceReport(evidence), true);
});

test("a published version carrying different content is recorded as diverged", () => {
  const hyper = evidence.packages.find((entry) => entry.packageName === "visp-hyper-agent");

  // This is the whole point: npm and the repository both claim 0.3.0 and the
  // contents are not the same. A version range would call these compatible.
  assert.equal(hyper.status, "diverged");
  assert.notEqual(hyper.local.sha256, hyper.published.sha256);
  assert.ok(hyper.comparison.differing.length > 0, "expected differing files");
  assert.match(hyper.localCommit, /^[0-9a-f]{40}$/u);
});

test("the report is self-hashed and tamper-evident", () => {
  const tampered = structuredClone(evidence);
  tampered.packages[0].status = "identical";

  assert.throws(() => verifyDivergenceReport(tampered), /hash does not match/u);
});

test("claiming diverged while the hashes match is rejected", () => {
  const contradictory = createDivergenceReport({
    packages: [
      {
        packageName: "x",
        version: "1.0.0",
        status: "identical",
        local: { sha256: "a".repeat(64), fileCount: 1 },
        published: { sha256: "a".repeat(64), fileCount: 1 },
        comparison: { onlyLocal: [], onlyPublished: [], differing: [], identical: 1 }
      }
    ]
  });

  assert.equal(verifyDivergenceReport(contradictory), true);

  const lying = structuredClone(contradictory);
  lying.packages[0].status = "diverged";
  delete lying.reportSha256;
  const resealed = createDivergenceReport({ packages: lying.packages });

  assert.throws(() => verifyDivergenceReport(resealed), /reports diverged but the hashes match/u);
});

test("the verifier subprocess preserves argv and paths through a real executable", async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), "visp-divergence-wrapper-"));
  const fixture = path.join(base, "verification path with spaces");
  const reportPath = path.join(fixture, "divergence report.json");

  t.after(() => rm(base, { recursive: true, force: true }));
  await mkdir(fixture);
  await writeFile(reportPath, JSON.stringify(evidence));
  const wrapper = await createNodeCommandWrapper(base);
  const forwarded = ["scripts/run-registry-divergence.mjs", "--verify", reportPath];

  await run(
    wrapper.command,
    [...wrapper.commandArgs, ...forwarded],
    {
      cwd: new URL("..", import.meta.url),
      maxBuffer: 8 * 1024 * 1024
    }
  );
  const observedArgv = JSON.parse(await readFile(wrapper.marker, "utf8"));
  const verified = JSON.parse(await readFile(reportPath, "utf8"));

  assert.deepEqual(observedArgv, forwarded);
  assert.equal(verified.reportSha256, evidence.reportSha256);
  assert.equal(verifyDivergenceReport(verified), true);
});

test(
  "the subprocess runner self-verifies two packages with distinct scratch roots",
  {
    skip:
      process.platform === "win32"
        ? "packPackageTwice requires POSIX Git mode materialization; the verifier wrapper test retains Windows subprocess and argv coverage"
        : false
  },
  async (t) => {
    const base = await mkdtemp(path.join(tmpdir(), "visp-divergence-two-targets-"));
    const store = path.join(base, "empty-store");

    t.after(() => rm(base, { recursive: true, force: true }));
    await mkdir(store);

    const repositories = [];
    for (const [name, version] of [["fixture-one", "1.0.0"], ["fixture-two", "2.0.0"]]) {
      const repository = path.join(base, name);

      await mkdir(repository);
      await writeFile(path.join(repository, "package.json"), `${JSON.stringify({ name, version }, null, 2)}\n`);
      await run("git", ["init", "-q"], { cwd: repository });
      await run("git", ["config", "user.name", "Visp Test"], { cwd: repository });
      await run("git", ["config", "user.email", "visp-test@example.invalid"], { cwd: repository });
      await run("git", ["add", "package.json"], { cwd: repository });
      await run("git", ["commit", "-q", "-m", "fixture"], { cwd: repository });
      repositories.push({ name, repository });
    }

    const npmExecutable = "npm";
    const fakeNpmScript = path.join(base, "fake-npm.mjs");

    await writeFile(
      fakeNpmScript,
      `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
if (args[0] === "view") { process.stdout.write("{}\\n"); process.exit(0); }
if (args[0] === "pack" && args[1]?.includes("@")) { process.stderr.write("unavailable\\n"); process.exit(1); }
const result = spawnSync(${JSON.stringify(npmExecutable)}, args, { cwd: process.cwd(), env: process.env, stdio: "inherit" });
process.exit(result.status ?? 1);
`,
      { mode: 0o755 }
    );
    const args = [
      "scripts/run-registry-divergence.mjs",
      ...repositories.flatMap(({ name, repository }) => ["--repository", `${name}=${repository}`]),
      "--offline-store", store,
      "--package-manager", "pnpm",
      "--npm", fakeNpmScript,
      "--output", path.join(base, "divergence.json")
    ];
    await run(process.execPath, args, {
      cwd: new URL("..", import.meta.url),
      maxBuffer: 8 * 1024 * 1024
    });
    const report = JSON.parse(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(path.join(base, "divergence.json"), "utf8")
      )
    );

    assert.equal(verifyDivergenceReport(report), true);
    assert.equal(report.packages.length, 2);
    assert.equal(new Set(report.packages.map((entry) => entry.scratchRootSha256)).size, 2);
  }
);
