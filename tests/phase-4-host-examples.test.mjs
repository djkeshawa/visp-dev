import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  createPhase4HostExamplesReport,
  verifyPhase4HostExamplesReport,
} from "../src/phase-4-host-examples.mjs";

const HOSTS = ["claude-code", "codex", "copilot", "generic", "opencode"];
const packageSha256 = "a".repeat(64);
const assets = {
  "claude-code": [
    ["agents/coordinator.md", ".claude/agents/coordinator.md"],
    ["skills/visp-hyper/SKILL.md", ".claude/skills/visp-hyper/SKILL.md"],
  ],
  codex: [["skills/visp-hyper/SKILL.md", ".agents/skills/visp-hyper/SKILL.md"]],
  copilot: [["instructions.md", ".github/instructions/visp-hyper.instructions.md"]],
  generic: [["instructions.md", "visp-hyper-instructions.md"]],
  opencode: [["skills/visp-hyper/SKILL.md", ".agents/skills/visp-hyper/SKILL.md"]],
};

async function createTemplatesFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "visp-dev-phase-4-fixture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const host of HOSTS) {
    const hostRoot = path.join(root, host);
    await mkdir(hostRoot, { recursive: true });
    const manifest = {
      manifestVersion: "1.0",
      host,
      validatedAgainst: {
        asOf: "2026-07-25",
        hostVersion: null,
        surface: `${host} fixture surface`,
        documentation: [`https://example.com/${host}`],
      },
      supports: {
        repoGuidance: host === "generic" ? "manual" : "native",
        skills: host === "generic" ? "unsupported" : "native",
        commands: "manual",
        hooks: "native",
        mcp: "native",
        subagents: host === "generic" ? "unsupported" : "native",
        verifierRole: "manual",
        challengerRole: "manual",
        automaticModelSelection: "unsupported",
      },
      fallbacks: {
        mechanicalEnforcement: "git_and_ci",
        orchestration: host === "generic" ? "sequential" : "native_subagents",
        modelSelection: host === "generic" ? "advisory" : "host_controlled",
      },
      assets: assets[host].map(([templatePath, destination]) => ({
        templatePath,
        destination,
      })),
    };
    await writeFile(
      path.join(hostRoot, "capabilities.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    for (const [templatePath] of assets[host]) {
      const destination = path.join(hostRoot, templatePath);
      await mkdir(path.dirname(destination), { recursive: true });
      const frontmatter = host === "copilot" ? '---\napplyTo: "**"\n---\n' : "";
      await writeFile(destination, `${frontmatter}${host} {{SCOUT_MODEL}}\n`, "utf8");
    }
  }
  return root;
}

test("Phase 4 unit report is standalone and validates exact host manifests", async (t) => {
  const templatesRoot = await createTemplatesFixture(t);
  const report = await createPhase4HostExamplesReport({ packageSha256, templatesRoot });
  assert.equal(verifyPhase4HostExamplesReport(report), true);
  assert.equal(report.summary.hostsVerified, 5);
  assert.equal(report.summary.assetsVerified, 6);
  assert.equal(report.summary.runtimeVerified, false);
  assert.equal(report.runtime, null);
  assert.deepEqual(report.examples.map(({ host }) => host), HOSTS);
  assert.equal(
    report.examples.find(({ host }) => host === "generic").fallbacks.orchestration,
    "sequential",
  );
  assert.throws(
    () => verifyPhase4HostExamplesReport(report, { requireRuntime: true }),
    /runtime verification is required/i,
  );
});

test("Phase 4 host verifier rejects semantic and integrity drift", async (t) => {
  const templatesRoot = await createTemplatesFixture(t);
  const report = await createPhase4HostExamplesReport({ packageSha256, templatesRoot });
  for (const mutate of [
    (candidate) => { candidate.examples[0].fallbacks.mechanicalEnforcement = "native_hooks"; },
    (candidate) => { candidate.examples[1].assets[0].destination = "../escape"; },
    (candidate) => { candidate.examples[2].supports.hooks = true; },
    (candidate) => { candidate.examples.pop(); },
    (candidate) => { candidate.packageSha256 = "0".repeat(64); },
  ]) {
    const candidate = structuredClone(report);
    mutate(candidate);
    assert.throws(() => verifyPhase4HostExamplesReport(candidate));
  }
});

test("Phase 4 manifest loader rejects unknown fields and incomplete exact contracts", async (t) => {
  for (const mutate of [
    (manifest) => { manifest.unknown = true; },
    (manifest) => { delete manifest.validatedAgainst.hostVersion; },
    (manifest) => { manifest.validatedAgainst.documentation = ["not-a-url"]; },
    (manifest) => { manifest.fallbacks.modelSelection = "guess"; },
    (manifest) => { manifest.assets[0].extra = true; },
  ]) {
    const templatesRoot = await createTemplatesFixture(t);
    const manifestPath = path.join(templatesRoot, "generic", "capabilities.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    mutate(manifest);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await assert.rejects(
      createPhase4HostExamplesReport({ packageSha256, templatesRoot }),
      /manifest|validatedAgainst|fallbacks|asset/i,
    );
  }
});
