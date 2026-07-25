import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  canonicalStringify,
  cleanupOwnedRoot,
  createOwnedRoot,
  installLocalTarball,
  packPackageTwice,
  runProcess,
  sha256Hex,
} from "./compatibility-lab.mjs";
import { materializeRuntimeInstallLock } from "./compatibility-matrix.mjs";

const HASH = /^[0-9a-f]{64}$/u;
const PREFIXED_HASH = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const PHASE_2_COMPATIBILITY_DEFINITION = deepFreeze({
  pair: {
    hyper: {
      commit: "98b65d05a10766cb66b1caa9cb7ae3c5c589137d",
      tree: "34bb04ed2454e389f7aca7bea76fd05ab81f264c",
    },
    kit: {
      commit: "3dbc9184e8ee4bb7d1599aa825bfd2ed57b384d8",
      tree: "6b5a45bed9f97007490f553c0d6d3af81be8ae2e",
    },
  },
  profiles: [
    {
      humanApproval: false,
      id: "routine_candidate_evidence",
      profile: "routine",
      riskFactors: [],
      riskLevel: "low",
      taskClass: "documentation",
      taskId: "T001",
      testIndependence: "pre_existing",
    },
    {
      humanApproval: false,
      id: "behavioral_candidate_evidence",
      profile: "behavioral",
      riskFactors: [],
      riskLevel: "medium",
      taskClass: "bounded_feature",
      taskId: "T001",
      testIndependence: "pre_approved",
    },
    {
      humanApproval: true,
      id: "critical_candidate_evidence",
      profile: "critical",
      riskFactors: [{ code: "authorization", version: "1.0" }],
      riskLevel: "high",
      taskClass: "security",
      taskId: "T001",
      testIndependence: "pre_approved",
    },
  ],
  schemaHash: "41ffa28fcd4476ea1812ff307df67a7ab7edb5b2cf4d6c11955d34d4aad74d4d",
  surfaces: ["run", "next", "resume", "checkpoint", "guard", "mcp"],
});

export const PHASE_2_COMPATIBILITY_SHA256 = sha256Hex(
  canonicalStringify(PHASE_2_COMPATIBILITY_DEFINITION),
);

function plain(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  plain(value, label);
  if (canonicalStringify(Object.keys(value).sort()) !== canonicalStringify([...keys].sort())) {
    throw new Error(`${label} has an unexpected field set`);
  }
}

function exactValue(actual, expected, label) {
  if (canonicalStringify(actual) !== canonicalStringify(expected)) {
    throw new Error(`${label} drifted from the Phase 2 definition`);
  }
}

function validateArtifact(artifact, label) {
  exactKeys(artifact, ["path", "sha256"], label);
  if (typeof artifact.path !== "string"
    || path.isAbsolute(artifact.path)
    || artifact.path.includes("..")
    || !PREFIXED_HASH.test(artifact.sha256)) {
    throw new Error(`${label} is not a stable project-relative artifact binding`);
  }
}

function validatePackage(record, kind) {
  const expected = PHASE_2_COMPATIBILITY_DEFINITION.pair[kind];
  const name = kind === "kit" ? "visp-kit" : "visp-hyper-agent";
  const bin = kind === "kit" ? "visp" : "visp-hyper";
  exactKeys(record, ["install", "pack", "runtimeLock", "source"], `Phase 2 ${kind} package`);
  exactValue(record.source, expected, `Phase 2 ${kind} source`);
  if (!COMMIT.test(record.source.commit) || !COMMIT.test(record.source.tree)
    || record.pack?.byteEquality !== true
    || record.pack?.first?.sha256 !== record.pack?.second?.sha256
    || !HASH.test(record.pack?.first?.sha256 ?? "")
    || record.install?.offline !== true
    || record.install?.lifecycleScriptsDisabled !== true
    || !record.install?.bins?.some(
      (entry) => entry.name === bin
        && entry.target === `node_modules/${name}/dist/index.js`
        && HASH.test(entry.sha256),
    )
    || !HASH.test(record.runtimeLock?.materializedSha256 ?? "")
    || !HASH.test(record.runtimeLock?.templateSha256 ?? "")) {
    throw new Error(`Phase 2 ${kind} package is not duplicate-packed and tarball-installed`);
  }
}

function validateEvidence(evidence, definition, label) {
  exactKeys(evidence, ["freshness", "outcome", "providers", "source"], label);
  if (evidence.source !== "candidate"
    || evidence.outcome !== "passed"
    || evidence.freshness !== "fresh"
    || !Array.isArray(evidence.providers)
    || evidence.providers.length === 0) {
    throw new Error(`${label} does not prove fresh passed candidate evidence`);
  }
  let independentPass = false;
  for (const provider of evidence.providers) {
    exactKeys(provider, ["results", "status"], `${label} provider`);
    if (provider.status !== "passed" || !Array.isArray(provider.results)
      || provider.results.length === 0) {
      throw new Error(`${label} provider did not pass`);
    }
    for (const result of provider.results) {
      exactKeys(
        result,
        ["freshness", "independence", "status"],
        `${label} provider result`,
      );
      if (result.status !== "passed" || result.freshness !== "fresh") {
        throw new Error(`${label} provider result is not a fresh pass`);
      }
      if (result.independence === definition.testIndependence) independentPass = true;
    }
  }
  if (!independentPass) throw new Error(`${label} lacks the required test independence`);
}

function validateProfile(record, definition) {
  const label = `Phase 2 profile ${definition.profile}`;
  exactKeys(
    record,
    ["artifacts", "humanApproval", "id", "kit", "profile", "surfaces", "taskId"],
    label,
  );
  if (record.id !== definition.id
    || record.profile !== definition.profile
    || record.taskId !== definition.taskId
    || record.humanApproval !== definition.humanApproval) {
    throw new Error(`${label} identity drifted`);
  }
  exactKeys(record.artifacts, ["baseline", "candidate", "lock", "plan"], `${label} artifacts`);
  for (const [kind, artifact] of Object.entries(record.artifacts)) {
    validateArtifact(artifact, `${label} ${kind}`);
  }
  exactKeys(
    record.kit,
    ["actionId", "evidence", "profile", "protocolVersion", "schemaHash"],
    `${label} Kit action`,
  );
  if (record.kit.profile !== definition.profile
    || record.kit.protocolVersion !== "3.1"
    || record.kit.schemaHash !== `sha256:${PHASE_2_COMPATIBILITY_DEFINITION.schemaHash}`
    || !PREFIXED_HASH.test(record.kit.actionId)) {
    throw new Error(`${label} Kit action identity drifted`);
  }
  validateEvidence(record.kit.evidence, definition, `${label} Kit evidence`);
  if (!Array.isArray(record.surfaces)
    || record.surfaces.length !== PHASE_2_COMPATIBILITY_DEFINITION.surfaces.length) {
    throw new Error(`${label} must contain exactly six surfaces`);
  }
  for (let index = 0; index < PHASE_2_COMPATIBILITY_DEFINITION.surfaces.length; index += 1) {
    const surface = record.surfaces[index];
    const expectedSurface = PHASE_2_COMPATIBILITY_DEFINITION.surfaces[index];
    exactKeys(
      surface,
      ["actionId", "evidence", "id", "profile", "protocolVersion", "schemaHash"],
      `${label} surface ${expectedSurface}`,
    );
    if (surface.id !== expectedSurface
      || surface.profile !== definition.profile
      || surface.protocolVersion !== "3.1"
      || surface.schemaHash !== `sha256:${PHASE_2_COMPATIBILITY_DEFINITION.schemaHash}`
      || surface.actionId !== record.kit.actionId) {
      throw new Error(`${label} surface ${expectedSurface} identity drifted`);
    }
    exactValue(
      surface.evidence,
      record.kit.evidence,
      `${label} surface ${expectedSurface} evidence`,
    );
    validateEvidence(surface.evidence, definition, `${label} surface ${expectedSurface} evidence`);
  }
}

export function createPhase2CompatibilityReport(input) {
  plain(input, "Phase 2 report input");
  const report = {
    definitionSha256: PHASE_2_COMPATIBILITY_SHA256,
    environment: structuredClone(input.environment),
    packages: structuredClone(input.packages),
    pair: structuredClone(PHASE_2_COMPATIBILITY_DEFINITION.pair),
    profiles: structuredClone(input.profiles),
    schemaHash: `sha256:${PHASE_2_COMPATIBILITY_DEFINITION.schemaHash}`,
    schemaVersion: "visp.phase-2-compatibility.evidence.v1",
    summary: {
      profilesPassed: input.profiles.length,
      surfacesPassed: input.profiles.reduce((count, profile) => count + profile.surfaces.length, 0),
      testsPassed: true,
    },
  };
  report.reportSha256 = sha256Hex(canonicalStringify(report));
  verifyPhase2CompatibilityReport(report);
  return JSON.parse(canonicalStringify(report));
}

export function verifyPhase2CompatibilityReport(report) {
  exactKeys(
    report,
    [
      "definitionSha256",
      "environment",
      "packages",
      "pair",
      "profiles",
      "reportSha256",
      "schemaHash",
      "schemaVersion",
      "summary",
    ],
    "Phase 2 report",
  );
  if (report.schemaVersion !== "visp.phase-2-compatibility.evidence.v1"
    || report.definitionSha256 !== PHASE_2_COMPATIBILITY_SHA256
    || report.schemaHash !== `sha256:${PHASE_2_COMPATIBILITY_DEFINITION.schemaHash}`
    || !HASH.test(report.reportSha256)) {
    throw new Error("Phase 2 report identity is invalid");
  }
  const unhashed = structuredClone(report);
  delete unhashed.reportSha256;
  if (report.reportSha256 !== sha256Hex(canonicalStringify(unhashed))) {
    throw new Error("Phase 2 report hash does not match its content");
  }
  exactValue(report.pair, PHASE_2_COMPATIBILITY_DEFINITION.pair, "Phase 2 pair");
  exactKeys(report.packages, ["hyper", "kit"], "Phase 2 packages");
  validatePackage(report.packages.kit, "kit");
  validatePackage(report.packages.hyper, "hyper");
  exactKeys(
    report.environment,
    ["architecture", "git", "node", "npm", "operatingSystem", "pnpm"],
    "Phase 2 environment",
  );
  if (Object.values(report.environment).some(
    (value) => typeof value !== "string" || value.length === 0,
  )) {
    throw new Error("Phase 2 environment is incomplete");
  }
  if (!Array.isArray(report.profiles)
    || report.profiles.length !== PHASE_2_COMPATIBILITY_DEFINITION.profiles.length) {
    throw new Error("Phase 2 report must contain exactly three profiles");
  }
  report.profiles.forEach((profile, index) => {
    validateProfile(profile, PHASE_2_COMPATIBILITY_DEFINITION.profiles[index]);
  });
  exactValue(report.summary, {
    profilesPassed: 3,
    surfacesPassed: 18,
    testsPassed: true,
  }, "Phase 2 summary");
  const rendered = canonicalStringify(report);
  if (/visp-compatibility-lab-|timestamp|generatedAt|checkedAt|duration|\/tmp\//iu.test(rendered)) {
    throw new Error("Phase 2 report contains unstable runtime content");
  }
  return true;
}

function publicPack(pack) {
  return {
    byteSize: pack.byteSize,
    memberListSha256: pack.memberListSha256,
    members: pack.members,
    package: pack.package,
    sha256: pack.sha256,
    tool: pack.tool,
  };
}

export async function packAndInstall({
  definition,
  kind,
  offlineCacheSource,
  offlineStoreSource,
  npmCommand,
  ownedRoot,
  packageManagerCommand,
  repositoryRoot,
}) {
  const packageRoot = await createOwnedRoot({ baseDirectory: ownedRoot });
  const packed = await packPackageTwice({
    repositoryRoot,
    commit: definition.commit,
    ownedRoot: packageRoot.root,
    offlineStoreSource,
    packageManagerCommand,
    npmCommand,
  });
  if (packed.commit !== definition.commit || packed.tree !== definition.tree) {
    throw new Error(`Phase 2 ${kind} source identity drifted during packing`);
  }
  const runtimeLockPath = path.join(packageRoot.root, "runtime-package-lock.json");
  const runtimeLock = await materializeRuntimeInstallLock({
    outputPath: runtimeLockPath,
    package: packed.package,
    tarballPath: packed.tarballPath,
  });
  const fixture = path.join(packageRoot.root, "install");
  const install = await installLocalTarball({
    tarballPath: packed.tarballPath,
    fixtureRoot: fixture,
    npmCommand,
    offlineCacheSource,
    offlineInstallLockSource: runtimeLockPath,
  });
  const installedExecutable = path.join(
    fixture,
    "node_modules",
    ".bin",
    kind === "kit" ? "visp" : "visp-hyper",
  );
  const captureBin = path.join(packageRoot.root, "capture-bin");
  await mkdir(captureBin);
  const capturedExecutable = path.join(
    captureBin,
    kind === "kit" ? "visp" : "visp-hyper",
  );
  await writeFile(
    capturedExecutable,
    [
      "#!/usr/bin/env node",
      'import { spawnSync } from "node:child_process";',
      'import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";',
      'import { tmpdir } from "node:os";',
      'import { join } from "node:path";',
      'const root = mkdtempSync(join(tmpdir(), "visp-phase-2-cli-output-"));',
      'const stdoutPath = join(root, "stdout");',
      'const stderrPath = join(root, "stderr");',
      'const stdout = openSync(stdoutPath, "w");',
      'const stderr = openSync(stderrPath, "w");',
      `const result = spawnSync(${JSON.stringify(installedExecutable)}, process.argv.slice(2), {`,
      '  env: process.env, stdio: ["inherit", stdout, stderr],',
      "});",
      "closeSync(stdout);",
      "closeSync(stderr);",
      "writeSync(1, readFileSync(stdoutPath));",
      "writeSync(2, readFileSync(stderrPath));",
      "rmSync(root, { force: true, recursive: true });",
      "if (result.error) throw result.error;",
      "if (result.signal) process.kill(process.pid, result.signal);",
      "else process.exitCode = result.status ?? 1;",
      "",
    ].join("\n"),
    { flag: "wx", mode: 0o700 },
  );
  return {
    executable: capturedExecutable,
    fixture,
    report: {
      install,
      pack: {
        byteEquality: true,
        first: publicPack(packed.first),
        second: publicPack(packed.second),
      },
      runtimeLock,
      source: { commit: packed.commit, tree: packed.tree },
    },
  };
}

export async function toolVersion(command) {
  const result = await runProcess(command, ["--version"], { timeoutMs: 30_000 });
  if (result.spawnError || result.timedOut || result.exitCode !== 0) {
    throw new Error(`Cannot determine ${command} version`);
  }
  return result.stdout.text.trim();
}

export async function pathCommand(name) {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through the caller's executable search path.
    }
  }
  throw new Error(`Required Phase 2 executable unavailable: ${name}`);
}

export function executionEnvironment(kit, hyper, gitExecutable) {
  return {
    CI: "1",
    FORCE_COLOR: "0",
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "1",
    PATH: [
      path.dirname(kit.executable),
      path.dirname(hyper.executable),
      path.dirname(process.execPath),
      path.dirname(gitExecutable),
    ].join(path.delimiter),
    TZ: "UTC",
  };
}

export async function runExact(command, args, { cwd, env, stdin } = {}) {
  return runProcess(command, args, {
    cwd,
    env,
    ...(stdin === undefined ? {} : { stdin }),
    timeoutMs: 120_000,
  });
}

export function requireZero(result, label) {
  if (result.spawnError || result.timedOut || result.exitCode !== 0) {
    const error = new Error(`${label} failed`);
    error.observation = result;
    throw error;
  }
  return result;
}

export function parseJson(result, label) {
  try {
    return JSON.parse(result.stdout.text);
  } catch {
    throw new Error(`${label} did not emit JSON`);
  }
}

export function parseFrame(result, begin, end, label) {
  const pattern = new RegExp(`${begin}\\n([\\s\\S]*?)\\n${end}`, "gu");
  const matches = [...result.stdout.text.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`${label} did not emit exactly one canonical frame`);
  try {
    return JSON.parse(matches[0][1]);
  } catch {
    throw new Error(`${label} emitted malformed canonical JSON`);
  }
}

function normalizeCandidateView(action, definition, label) {
  const protocolVersion = action?.protocolVersion ?? action?.source?.protocolVersion;
  const canonicalVersion = action?.canonicalVersion
    ?? (action?.sourceCanonicalVersion?.state === "available"
      ? action.sourceCanonicalVersion.value
      : null);
  const actionId = typeof action?.actionId === "string"
    ? action.actionId
    : action?.actionId?.state === "available"
      ? action.actionId.value
      : null;
  const schemaHash = action?.source?.localSchemaHash
    ?? `sha256:${PHASE_2_COMPATIBILITY_DEFINITION.schemaHash}`;
  if (protocolVersion !== "3.1"
    || canonicalVersion !== "1.1"
    || !PREFIXED_HASH.test(actionId ?? "")
    || schemaHash !== `sha256:${PHASE_2_COMPATIBILITY_DEFINITION.schemaHash}`
    || action?.assurance?.profile?.state !== "available"
    || action.assurance.profile.value !== definition.profile
    || action?.evidence?.state !== "available") {
    throw new Error(`${label} did not preserve WorkflowAction 3.1 assurance`);
  }
  const evidence = action.evidence.value;
  if (evidence.source !== "candidate"
    || evidence.outcome !== "passed"
    || evidence.freshness !== "fresh"
    || !Array.isArray(evidence.providers)
    || evidence.providers.length === 0) {
    throw new Error(`${label} did not preserve fresh passed candidate evidence`);
  }
  const providers = evidence.providers.map((provider) => ({
    results: provider.results.map((result) => ({
      freshness: result.freshness?.status ?? null,
      independence: result.independence,
      status: result.outcome?.status ?? null,
    })),
    status: provider.status,
  }));
  const independence = providers.flatMap(({ results }) => results)
    .map((result) => result.independence);
  if (!independence.includes(definition.testIndependence)) {
    throw new Error(`${label} lost ${definition.testIndependence} test evidence`);
  }
  return {
    actionId,
    evidence: {
      freshness: evidence.freshness,
      outcome: evidence.outcome,
      providers,
      source: evidence.source,
    },
    profile: action.assurance.profile.value,
    protocolVersion,
    schemaHash,
  };
}

export async function readArtifactBinding(project, relativePath) {
  const bytes = await readFile(path.join(project, relativePath));
  return { path: relativePath, sha256: `sha256:${sha256Hex(bytes)}` };
}

async function updateJson(filePath, update) {
  const value = JSON.parse(await readFile(filePath, "utf8"));
  update(value);
  await writeFile(filePath, canonicalStringify(value));
}

export async function createRealProject({ definition, hyper, kit, root }) {
  const project = path.join(root, "project");
  await mkdir(project);
  const git = await pathCommand("git");
  const env = executionEnvironment(kit, hyper, git);
  const runKit = async (args, label) => requireZero(
    await runExact(kit.executable, args, { cwd: project, env }),
    label,
  );
  const scaffoldKit = async (args, label) => requireCompleted(
    await runExact(kit.executable, args, { cwd: project, env }),
    label,
  );
  const runHyper = async (args, label, stdin) => requireZero(
    await runExact(
      hyper.executable,
      ["--project", project, ...args],
      { cwd: project, env, ...(stdin === undefined ? {} : { stdin }) },
    ),
    label,
  );
  const runGit = async (args, label) => requireZero(
    await runExact(git, args, { cwd: project, env }),
    label,
  );

  await runGit(["init", "--quiet"], "Phase 2 Git initialization");
  await runKit(
    ["init", project, "--agent", "none", "--preset", "javascript", "--strictness", "strict", "--json"],
    "Phase 2 Kit initialization",
  );
  await runHyper(["init"], "Phase 2 Hyper initialization");
  await mkdir(path.join(project, "src"), { recursive: true });
  await mkdir(path.join(project, "tests"), { recursive: true });
  await mkdir(path.join(project, "docs"), { recursive: true });
  await writeFile(path.join(project, "package.json"), canonicalStringify({
    name: `phase-2-${definition.profile}-fixture`,
    private: true,
    scripts: { test: "node --test tests/profile.test.mjs" },
    type: "module",
  }));
  await writeFile(
    path.join(project, "src", "profile.mjs"),
    "export const evidenceProfile = () => \"candidate\";\n",
  );
  await writeFile(
    path.join(project, "tests", "profile.test.mjs"),
    [
      'import assert from "node:assert/strict";',
      'import test from "node:test";',
      'import { evidenceProfile } from "../src/profile.mjs";',
      'test("profile evidence", () => assert.equal(evidenceProfile(), "candidate"));',
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(project, "docs", "profile.md"),
    "# Evidence profile\n\nCandidate evidence is surfaced by the compatibility fixture.\n",
  );
  await runKit(["scan", project, "--json"], "Phase 2 scan");
  const featureResult = await runKit(
    [
      "feature",
      `${definition.profile} candidate evidence`,
      project,
      "--risk",
      definition.riskLevel,
      "--no-branch",
      "--json",
    ],
    "Phase 2 feature creation",
  );
  const featureSummary = parseJson(featureResult, "Phase 2 feature creation");
  const featureRelativePath = featureSummary.feature?.path;
  if (typeof featureRelativePath !== "string" || path.isAbsolute(featureRelativePath)) {
    throw new Error("Phase 2 feature creation returned an unsafe feature path");
  }
  const featureDir = path.join(project, featureRelativePath);
  await scaffoldKit(["clarify", project, "--json"], "Phase 2 clarification generation");
  await updateJson(path.join(featureDir, "clarifications.json"), (artifact) => {
    artifact.questions[0].question = "Should candidate evidence remain visible on every surface?";
    artifact.questions[0].recommendedDefault = "Yes, preserve the exact Kit evidence view.";
    artifact.questions[0].reason = "Compatibility depends on deterministic evidence presentation.";
  });
  await runKit(
    ["clarify", "answer", "CQ001", project, "--accept-default", "--json"],
    "Phase 2 clarification answer",
  );
  await scaffoldKit(["spec", project, "--json"], "Phase 2 specification generation");
  await updateJson(path.join(featureDir, "spec.json"), (spec) => {
    spec.status = "ready";
    spec.userStories[0] = {
      actor: "developer",
      capability: "inspect candidate evidence",
      id: "US001",
      outcome: "the assurance result remains visible",
      title: "Surface candidate evidence",
    };
    const criterion = {
      description: "The selected assurance profile and fresh passed candidate evidence remain visible.",
      id: "AC001",
      requirementId: "REQ001",
      testable: true,
      validationMethod: "unit",
    };
    spec.requirements[0].title = "Preserve candidate evidence";
    spec.requirements[0].description = "Expose Kit-owned evidence without changing its verdict.";
    spec.requirements[0].acceptanceCriteria = [criterion];
    spec.acceptanceCriteria = [criterion];
    spec.businessRules = ["Hyper presents evidence but does not decide sufficiency."];
    spec.nonFunctionalRequirements = {
      accessibility: ["Evidence is available as structured data."],
      maintainability: ["Use one versioned canonical contract."],
      performance: ["Evidence projection remains deterministic."],
      reliability: ["All supported surfaces preserve the evidence view."],
      security: ["No authority is transferred to Hyper."],
    };
    spec.edgeCases = ["Candidate evidence must not be replaced by stale baseline evidence."];
    spec.outOfScope = ["Changing Kit evidence policy."];
  });
  await runKit(["spec", project, "--validate", "--json"], "Phase 2 specification validation");
  await scaffoldKit(["plan", project, "--json"], "Phase 2 plan generation");
  await updateJson(path.join(featureDir, "plan.json"), (plan) => {
    plan.status = "ready";
    plan.evidence = {
      assumed: ["Installed binaries use the advertised protocol."],
      inferred: ["A focused fixture proves the public compatibility boundary."],
      knownFromCodebase: ["Kit and Hyper expose WorkflowAction 3.1."],
      knownFromConstitution: ["Kit remains authoritative."],
      knownFromSpecification: ["REQ001 and AC001 require evidence preservation."],
      knownFromUser: ["Run the exact packed Phase 2 pair."],
      unknown: ["No additional surface is in scope."],
    };
    plan.affectedModules[0] = {
      evidence: "Installed package behavior.",
      moduleOrFileArea: definition.profile === "routine" ? "docs/profile.md" : "src/profile.mjs",
      reason: "Provides a deterministic candidate change.",
    };
    plan.implementationApproach = "Exercise the installed binaries and compare their canonical evidence.";
    plan.impacts = {
      api: "No public API change.",
      dataModel: "No persistent model change.",
      performance: "One small local validation command.",
      securityPrivacy: "No external data.",
      ui: "No UI change.",
    };
    plan.testingStrategy[0] = {
      level: "unit",
      validationCommand: "node --test tests/profile.test.mjs",
      whatToTest: "Candidate evidence remains passed and fresh.",
    };
    plan.rollbackStrategy = "Discard the isolated temporary fixture.";
    plan.alternatives[0] = {
      decision: "rejected",
      option: "Source-tree execution.",
      reason: "It would not prove packed compatibility.",
    };
    plan.risks[0] = {
      description: "A surface could lose evidence fields.",
      id: "RISK001",
      level: definition.riskLevel,
      mitigation: "Assert all six canonical surfaces.",
      requirementIds: ["REQ001"],
    };
    plan.decisions[0] = {
      decision: "Use exact installed tarballs.",
      evidence: "REQ001; packed pair definition.",
      id: "PD001",
      impacts: "Compatibility evidence only.",
      reason: "This proves consumer behavior.",
      requirementIds: ["REQ001"],
      title: "Packed compatibility",
    };
  });
  await runKit(["plan", project, "--validate", "--json"], "Phase 2 plan validation");
  await scaffoldKit(["tasks", project, "--json"], "Phase 2 task generation");
  await updateJson(path.join(featureDir, "task-graph.json"), (graph) => {
    graph.status = "ready";
    graph.tasks[0] = {
      ...graph.tasks[0],
      allowedFiles: [definition.profile === "routine" ? "docs/profile.md" : "src/profile.mjs"],
      description: `Produce ${definition.profile} candidate evidence.`,
      expectedFiles: definition.profile === "routine"
        ? ["tests/profile.test.mjs"]
        : ["src/profile.mjs"],
      riskFactors: definition.riskFactors,
      riskLevel: definition.riskLevel,
      status: "ready",
      taskClass: definition.taskClass,
      title: `Verify ${definition.profile} candidate evidence`,
      validationCommands: ["node --test tests/profile.test.mjs"],
    };
  });
  await runKit(["tasks", project, "--validate", "--json"], "Phase 2 task validation");
  await runKit(
    ["context", definition.taskId, project, "--force", "--json"],
    "Phase 2 context generation",
  );
  await runGit(["add", "."], "Phase 2 baseline staging");
  await runGit(
    [
      "-c",
      "user.name=Visp Compatibility",
      "-c",
      "user.email=visp-compatibility@example.invalid",
      "commit",
      "--quiet",
      "-m",
      `baseline ${definition.profile}`,
    ],
    "Phase 2 baseline commit",
  );
  return { env, featureRelativePath, project, runGit, runHyper, runKit };
}

export function requireCompleted(result, label) {
  if (result.spawnError || result.timedOut || !Number.isInteger(result.exitCode)) {
    const error = new Error(`${label} did not complete`);
    error.observation = result;
    throw error;
  }
  return result;
}

async function runProfileScenario({ definition, hyper, kit, root }) {
  const context = await createRealProject({ definition, hyper, kit, root });
  const planArgs = [
    "oracle",
    "plan",
    context.project,
    "--task",
    definition.taskId,
    "--json",
  ];
  if (definition.testIndependence === "pre_approved") {
    planArgs.push("--pre-approved-test", "tests/profile.test.mjs");
  }
  await context.runKit(planArgs, `Phase 2 ${definition.profile} oracle plan`);
  if (definition.humanApproval) {
    await context.runKit(
      [
        "oracle",
        "approve",
        context.project,
        "--task",
        definition.taskId,
        "--reviewer",
        "human-compatibility-reviewer",
        "--reason",
        "The critical compatibility oracle and its pre-approved test were reviewed.",
        "--json",
      ],
      "Phase 2 critical oracle approval",
    );
  }
  await context.runKit(
    ["oracle", "lock", context.project, "--task", definition.taskId, "--json"],
    `Phase 2 ${definition.profile} initial oracle lock`,
  );
  await context.runKit(
    ["verify", context.project, "--baseline", "--task", definition.taskId, "--json"],
    `Phase 2 ${definition.profile} baseline`,
  );
  await context.runKit(
    ["gate", "implement", context.project, "--task", definition.taskId, "--json"],
    `Phase 2 ${definition.profile} implement authorization`,
  );
  const candidatePath = definition.profile === "routine"
    ? path.join(context.project, "docs", "profile.md")
    : path.join(context.project, "src", "profile.mjs");
  const original = await readFile(candidatePath, "utf8");
  await writeFile(candidatePath, `${original.trimEnd()}\n// candidate ${definition.profile}\n`);
  await context.runKit(
    ["verify", context.project, "--candidate", "--task", definition.taskId, "--json"],
    `Phase 2 ${definition.profile} candidate`,
  );

  const kitResult = requireCompleted(
    await runExact(
      kit.executable,
      ["next", context.project, "--format", "json", "--protocol", "3.1"],
      { cwd: context.project, env: context.env },
    ),
    `Phase 2 ${definition.profile} Kit 3.1 action`,
  );
  const kitView = normalizeCandidateView(
    parseJson(kitResult, `Phase 2 ${definition.profile} Kit 3.1 action`),
    definition,
    `Phase 2 ${definition.profile} Kit 3.1 action`,
  );

  const surfaceResults = new Map();
  const rawHyper = async (args, label, stdin) => requireCompleted(
    await runExact(
      hyper.executable,
      ["--project", context.project, ...args],
      { cwd: context.project, env: context.env, ...(stdin === undefined ? {} : { stdin }) },
    ),
    label,
  );
  surfaceResults.set(
    "run",
    await rawHyper(["run", `${definition.profile} compatibility proof`], "Phase 2 Hyper run"),
  );
  surfaceResults.set("next", await rawHyper(["next"], "Phase 2 Hyper next"));
  surfaceResults.set("resume", await rawHyper(["resume", "--json"], "Phase 2 Hyper resume"));
  surfaceResults.set(
    "checkpoint",
    await rawHyper(
      ["checkpoint", "--task", definition.taskId],
      "Phase 2 Hyper checkpoint",
    ),
  );
  await context.runGit(["add", "."], "Phase 2 candidate staging");
  surfaceResults.set(
    "guard",
    await rawHyper(["guard", "--staged"], "Phase 2 Hyper guard"),
  );
  const mcpInput = [
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "resources/read",
      params: { uri: "visp-hyper://current/canonical-action" },
    }),
    "",
  ].join("\n");
  surfaceResults.set(
    "mcp",
    await rawHyper(["serve", "--mcp"], "Phase 2 Hyper MCP", mcpInput),
  );
  const actions = new Map();
  actions.set(
    "run",
    parseFrame(
      surfaceResults.get("run"),
      "BEGIN_VISP_HYPER_ACTION_V1",
      "END_VISP_HYPER_ACTION_V1",
      "Phase 2 Hyper run",
    ).action,
  );
  actions.set(
    "next",
    parseFrame(
      surfaceResults.get("next"),
      "BEGIN_VISP_HYPER_ACTION_V1",
      "END_VISP_HYPER_ACTION_V1",
      "Phase 2 Hyper next",
    ).action,
  );
  actions.set("resume", parseJson(surfaceResults.get("resume"), "Phase 2 Hyper resume").action);
  actions.set(
    "checkpoint",
    parseFrame(
      surfaceResults.get("checkpoint"),
      "BEGIN_VISP_HYPER_ACTION_V1",
      "END_VISP_HYPER_ACTION_V1",
      "Phase 2 Hyper checkpoint",
    ).action,
  );
  actions.set(
    "guard",
    parseFrame(
      surfaceResults.get("guard"),
      "BEGIN_VISP_HYPER_ACTION_V1",
      "END_VISP_HYPER_ACTION_V1",
      "Phase 2 Hyper guard",
    ).action,
  );
  const mcpMessages = surfaceResults.get("mcp").stdout.text.trim().split("\n").map(JSON.parse);
  const resource = mcpMessages.find(({ id }) => id === 2)?.result?.contents?.[0]?.text;
  if (typeof resource !== "string") throw new Error("Phase 2 Hyper MCP omitted canonical action");
  actions.set("mcp", JSON.parse(resource).envelope.action);

  const assuranceDir = path.posix.join(
    context.featureRelativePath.replaceAll("\\", "/"),
    "assurance",
    definition.taskId,
  );
  const artifacts = {
    baseline: await readArtifactBinding(
      context.project,
      path.posix.join(assuranceDir, "baseline-evidence.json"),
    ),
    candidate: await readArtifactBinding(
      context.project,
      path.posix.join(assuranceDir, "candidate-evidence.json"),
    ),
    lock: await readArtifactBinding(
      context.project,
      path.posix.join(assuranceDir, "oracle-lock.json"),
    ),
    plan: await readArtifactBinding(
      context.project,
      path.posix.join(assuranceDir, "oracle-plan.json"),
    ),
  };
  if (definition.humanApproval) {
    const approval = JSON.parse(await readFile(
      path.join(context.project, assuranceDir, "oracle-approval.json"),
      "utf8",
    ));
    if (approval.status !== "approved") throw new Error("Phase 2 critical approval is not active");
  }
  return {
    artifacts,
    humanApproval: definition.humanApproval,
    id: definition.id,
    kit: kitView,
    profile: definition.profile,
    surfaces: PHASE_2_COMPATIBILITY_DEFINITION.surfaces.map((id) => ({
      id,
      ...normalizeCandidateView(
        actions.get(id),
        definition,
        `Phase 2 ${definition.profile} Hyper ${id}`,
      ),
    })),
    taskId: definition.taskId,
  };
}

export async function runPackedPhase2Compatibility(input) {
  plain(input, "Phase 2 runner input");
  for (const field of [
    "hyperRepositoryRoot",
    "kitRepositoryRoot",
    "offlineCacheSource",
    "offlineStoreSource",
    "packageManagerCommand",
    "npmCommand",
  ]) {
    if (typeof input[field] !== "string" || input[field].length === 0) {
      throw new TypeError(`${field} must be a non-empty path`);
    }
  }
  if (input.keepOwnedRoot !== undefined && typeof input.keepOwnedRoot !== "boolean") {
    throw new TypeError("keepOwnedRoot must be a boolean");
  }
  const owned = await createOwnedRoot();
  try {
    const kit = await packAndInstall({
      definition: PHASE_2_COMPATIBILITY_DEFINITION.pair.kit,
      kind: "kit",
      offlineCacheSource: input.offlineCacheSource,
      offlineStoreSource: input.offlineStoreSource,
      npmCommand: input.npmCommand,
      ownedRoot: owned.root,
      packageManagerCommand: input.packageManagerCommand,
      repositoryRoot: input.kitRepositoryRoot,
    });
    const hyper = await packAndInstall({
      definition: PHASE_2_COMPATIBILITY_DEFINITION.pair.hyper,
      kind: "hyper",
      offlineCacheSource: input.offlineCacheSource,
      offlineStoreSource: input.offlineStoreSource,
      npmCommand: input.npmCommand,
      ownedRoot: owned.root,
      packageManagerCommand: input.packageManagerCommand,
      repositoryRoot: input.hyperRepositoryRoot,
    });
    const profiles = [];
    for (const definition of PHASE_2_COMPATIBILITY_DEFINITION.profiles) {
      const profileRoot = await createOwnedRoot({ baseDirectory: owned.root });
      profiles.push(await runProfileScenario({
        definition,
        hyper,
        kit,
        root: profileRoot.root,
      }));
    }
    const report = createPhase2CompatibilityReport({
      environment: {
        architecture: process.arch,
        git: await toolVersion("git"),
        node: process.version,
        npm: await toolVersion(input.npmCommand),
        operatingSystem: process.platform,
        pnpm: await toolVersion(input.packageManagerCommand),
      },
      packages: { hyper: hyper.report, kit: kit.report },
      profiles,
    });
    if (input.keepOwnedRoot === true) {
      Object.defineProperty(report, "retainedRoot", { enumerable: false, value: owned.root });
    }
    return report;
  } catch (error) {
    if (input.keepOwnedRoot === true) {
      Object.defineProperty(error, "retainedRoot", { enumerable: false, value: owned.root });
    }
    throw error;
  } finally {
    if (input.keepOwnedRoot !== true) await cleanupOwnedRoot({ root: owned.root });
  }
}
