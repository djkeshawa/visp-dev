/**
 * Real projects, scaffolded by the installed pair, for a suite to measure.
 *
 * `createRealProject` drives Kit and Hyper through a full authored workflow —
 * init, scan, feature, clarify, spec, plan, tasks, context — and commits a
 * baseline. `createScenarioProject` builds the minimal init-only project the
 * matrix rows need. Both return the environment and the resolved executables,
 * so a caller never rebuilds either.
 *
 * TWO SETS OF PRIVATE RUNNERS LIVE HERE, and they are not redundant. The
 * matrix's scenario runners use a 30 s timeout, a PATH-only command lookup with
 * no PATHEXT handling, and a `requireZero` that throws without attaching the
 * observation. The authored-workflow runners use 120 s, the PATHEXT-aware
 * lookup, and an observation-carrying failure. Every pinned matrix row and
 * every pinned suite hash was produced under one of these exact pairings.
 * Unifying them would change timeouts and failure payloads under pins that
 * cannot be recomputed, so they are named apart rather than merged.
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { canonicalStringify, sha256Hex } from "../platform/canonical-json.mjs";
import { runExact, requireZero, runProcess } from "./process.mjs";
import { executionEnvironment, pathCommand } from "./pair-install.mjs";
import { parseJson, requireCompleted } from "./cli-output.mjs";

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

  await runGit(["init", "--quiet"], "Fixture Git initialization");
  await runKit(
    ["init", project, "--agent", "none", "--preset", "javascript", "--strictness", "strict", "--json"],
    "Fixture Kit initialization",
  );
  await runHyper(["init"], "Fixture Hyper initialization");
  await mkdir(path.join(project, "src"), { recursive: true });
  await mkdir(path.join(project, "tests"), { recursive: true });
  await mkdir(path.join(project, "docs"), { recursive: true });
  await writeFile(path.join(project, "package.json"), canonicalStringify({
    name: `${definition.profile}-profile-fixture`,
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
  await runKit(["scan", project, "--json"], "Fixture scan");
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
    "Fixture feature creation",
  );
  const featureSummary = parseJson(featureResult, "Fixture feature creation");
  const featureRelativePath = featureSummary.feature?.path;
  if (typeof featureRelativePath !== "string" || path.isAbsolute(featureRelativePath)) {
    throw new Error("Fixture feature creation returned an unsafe feature path");
  }
  const featureDir = path.join(project, featureRelativePath);
  await scaffoldKit(["clarify", project, "--json"], "Fixture clarification generation");
  await updateJson(path.join(featureDir, "clarifications.json"), (artifact) => {
    artifact.questions[0].question = "Should candidate evidence remain visible on every surface?";
    artifact.questions[0].recommendedDefault = "Yes, preserve the exact Kit evidence view.";
    artifact.questions[0].reason = "Compatibility depends on deterministic evidence presentation.";
  });
  await runKit(
    ["clarify", "answer", "CQ001", project, "--accept-default", "--json"],
    "Fixture clarification answer",
  );
  await scaffoldKit(["spec", project, "--json"], "Fixture specification generation");
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
  await runKit(["spec", project, "--validate", "--json"], "Fixture specification validation");
  await scaffoldKit(["plan", project, "--json"], "Fixture plan generation");
  await updateJson(path.join(featureDir, "plan.json"), (plan) => {
    plan.status = "ready";
    plan.evidence = {
      assumed: ["Installed binaries use the advertised protocol."],
      inferred: ["A focused fixture proves the public compatibility boundary."],
      knownFromCodebase: ["Kit and Hyper expose WorkflowAction 3.1."],
      knownFromConstitution: ["Kit remains authoritative."],
      knownFromSpecification: ["REQ001 and AC001 require evidence preservation."],
      knownFromUser: ["Run the exact packed pair."],
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
  await runKit(["plan", project, "--validate", "--json"], "Fixture plan validation");
  await scaffoldKit(["tasks", project, "--json"], "Fixture task generation");
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
  await runKit(["tasks", project, "--validate", "--json"], "Fixture task validation");
  await runKit(
    ["context", definition.taskId, project, "--force", "--json"],
    "Fixture context generation",
  );
  await runGit(["add", "."], "Fixture baseline staging");
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
    "Fixture baseline commit",
  );
  return { env, featureRelativePath, project, runGit, runHyper, runKit };
}

// --- the matrix scenario runners; see the header for why they stay distinct ---

function scenarioInstalledExecutable(artifact, binName) {
  if (!artifact.evidence.install.bins.some(({ name }) => name === binName)) {
    throw new Error(`Installed binary is missing: ${binName}`);
  }
  return path.join(artifact.fixture, "node_modules", ".bin", binName);
}

function scenarioEnvironment(kitArtifact, hyperArtifact, extra = {}) {
  const directories = [
    path.join(kitArtifact.fixture, "node_modules", ".bin"),
    path.join(hyperArtifact.fixture, "node_modules", ".bin"),
    path.dirname(process.execPath),
  ];
  return {
    CI: "1",
    FORCE_COLOR: "0",
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "1",
    PATH: directories.join(path.delimiter),
    TZ: "UTC",
    ...extra,
  };
}

async function scenarioRunExact(command, args, { cwd, env, stdin } = {}) {
  return runProcess(command, args, {
    cwd,
    env,
    ...(stdin === undefined ? {} : { stdin }),
    timeoutMs: 30_000,
  });
}

async function scenarioPathCommand(name) {
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
  throw new Error(`Required scenario executable unavailable: ${name}`);
}

async function scenarioRequireZero(result, label) {
  if (result.spawnError || result.timedOut || result.exitCode !== 0) {
    throw new Error(`${label} failed`);
  }
}

export async function createScenarioProject(root, kitArtifact, hyperArtifact) {
  const project = path.join(root, "project");
  await mkdir(project);
  const environment = scenarioEnvironment(kitArtifact, hyperArtifact);
  const gitExecutable = await scenarioPathCommand("git");
  environment.PATH = `${environment.PATH}${path.delimiter}${path.dirname(gitExecutable)}`;
  const gitInit = await scenarioRunExact(gitExecutable, ["init", "--quiet"], {
    cwd: project,
    env: environment,
  });
  await scenarioRequireZero(gitInit, "Scenario Git initialization");
  const kit = scenarioInstalledExecutable(kitArtifact, "visp");
  const hyper = scenarioInstalledExecutable(hyperArtifact, "visp-hyper");
  await scenarioRequireZero(
    await scenarioRunExact(
      kit,
      ["init", project, "--agent", "none", "--strictness", "strict", "--json"],
      { cwd: project, env: environment },
    ),
    "Scenario Kit initialization",
  );
  await scenarioRequireZero(
    await scenarioRunExact(hyper, ["--project", project, "init"], { cwd: project, env: environment }),
    "Scenario Hyper initialization",
  );
  return { environment, hyper, kit, project };
}

export { scenarioRunExact, scenarioEnvironment, scenarioInstalledExecutable };
