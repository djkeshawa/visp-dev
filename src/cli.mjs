/**
 * The Visp Dev product shell.
 *
 * Deliberately thin. It reports state, resolves a supported pair from the
 * generated compatibility matrix, and tells you the exact next command. It
 * decides no gate, computes no evidence, and holds no workflow state — Kit
 * owns all of that, and duplicating any of it here would make Visp Dev a second
 * engine, which the phase specification forbids.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runProcess } from "./compatibility-lab.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A tool's version string, or null when the tool is absent or unreadable. */
export async function detectTool(command, args = ["--version"]) {
  const result = await runProcess(command, args, { timeoutMs: 15_000 });

  if (result.spawnError || result.timedOut || result.exitCode !== 0) return null;

  // runProcess captures stdout as { bytes, sha256, text }, not a bare string.
  const text = `${result.stdout?.text ?? ""}`.trim();

  return text.length > 0 ? text.split("\n")[0].trim() : null;
}

export async function readCompatibility() {
  return JSON.parse(await readFile(path.join(root, "compatibility.json"), "utf8"));
}

/**
 * The pair a user should target.
 *
 * The matrix is ordered oldest to newest and every pair is an accepted end
 * state, so the last entry is the current recommendation.
 */
export function supportedPair(matrix) {
  return matrix.pairs.at(-1) ?? null;
}

/**
 * Whether a Visp release can be obtained today.
 *
 * `published: false` means nothing in the matrix corresponds to a registry
 * release. The versions that *are* on npm are deprecated and predate the whole
 * matrix, so directing anyone at them would hand them the defective build this
 * product exists to prevent.
 */
export function installability(matrix) {
  if (matrix.published === true) {
    const release = matrix.supportedRelease;

    return {
      installable: true,
      reason:
        release === undefined
          ? "A published release matches the supported pair."
          : `A supported release is published: visp-kit@${release.kit} and visp-hyper-agent@${release.hyper}.`,
      guidance: "npm install -g visp-kit visp-hyper-agent"
    };
  }

  return {
    installable: false,
    reason:
      "No supported release is published. The only Visp versions on npm are deprecated and predate this compatibility matrix, so installing from the registry would obtain a build that is not supported.",
    guidance: "Build Kit and Hyper from source at the pinned commits below, or wait for a release."
  };
}

export async function collectEnvironment(projectPath) {
  const [node, npm, pnpm, git, kit, hyper] = await Promise.all([
    Promise.resolve(process.version),
    detectTool("npm"),
    detectTool("pnpm"),
    detectTool("git"),
    detectTool("visp"),
    detectTool("visp-hyper")
  ]);

  const insideWorkTree = await runProcess("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: projectPath,
    timeoutMs: 15_000
  });
  const gitRepository = `${insideWorkTree.stdout?.text ?? ""}`.trim() === "true";

  return { node, npm, pnpm, git, kit, hyper, gitRepository };
}

function nodeSatisfies(version, range) {
  // The matrix only ever expresses a floor, so a full semver range parser would
  // be more machinery than the data justifies.
  const required = Number.parseInt(`${range}`.replace(/^\D*/u, ""), 10);
  const actual = Number.parseInt(`${version}`.replace(/^v/u, ""), 10);

  return Number.isFinite(required) && Number.isFinite(actual) ? actual >= required : null;
}

export async function doctor(projectPath) {
  const matrix = await readCompatibility();
  const pair = supportedPair(matrix);
  const environment = await collectEnvironment(projectPath);
  const install = installability(matrix);
  const checks = [];
  const recovery = [];

  const nodeOk = pair === null ? null : nodeSatisfies(environment.node, pair.node);
  checks.push({
    name: "Node",
    value: environment.node,
    status: nodeOk === null ? "unknown" : nodeOk ? "ok" : "failed",
    detail: pair === null ? "no supported pair" : `requires ${pair.node}`
  });
  if (nodeOk === false) recovery.push(`Install Node ${pair.node}, then re-run visp-dev doctor.`);

  checks.push({
    name: "Git",
    value: environment.git ?? "not found",
    status: environment.git === null ? "failed" : "ok",
    detail: environment.gitRepository ? "project is a Git repository" : "project is not a Git repository"
  });
  if (environment.git === null) recovery.push("Install Git; Visp records evidence against commits.");
  if (!environment.gitRepository) recovery.push("Run git init in the project; evidence is bound to commits.");

  for (const [name, packageName, value] of [
    ["Visp Kit", "visp-kit", environment.kit],
    ["Visp Hyper Agent", "visp-hyper-agent", environment.hyper]
  ]) {
    const deprecated = (matrix.deprecated ?? []).find(
      (entry) => entry.name === packageName && entry.version === value
    );

    checks.push({
      name,
      value: value ?? "not installed",
      // Present is not the same as correct. A detected binary cannot be matched
      // to the supported pair, because the pair is pinned by commit and a
      // binary on PATH does not report one. Saying "ok" here would bless an
      // unknown build — and if it is one of the deprecated versions, it is the
      // defective build this product exists to prevent people running.
      status:
        value === null
          ? install.installable
            ? "failed"
            : "unavailable"
          : deprecated !== undefined
            ? "deprecated"
            : "unverified",
      detail:
        value === null
          ? install.reason
          : deprecated !== undefined
            ? `${packageName}@${value} is deprecated and unsupported. ${deprecated.reason}`
            : "detected on PATH, but cannot be matched to the supported pair, which is pinned by commit"
    });

    if (deprecated !== undefined) {
      recovery.push(
        `Uninstall ${packageName}@${value}; it is deprecated and unsupported. Build the supported commit from source instead.`
      );
    }
  }

  if (!install.installable) recovery.push(install.guidance);

  // A deprecated build in use is a failure: it is the specific defect the
  // product exists to prevent, and reporting it as a warning would understate it.
  const status = checks.some((check) => ["failed", "deprecated"].includes(check.status))
    ? "failed"
    : checks.some((check) => ["unavailable", "unverified"].includes(check.status))
      ? "blocked"
      : "ok";

  return { status, checks, recovery, pair, install, environment };
}

export async function versions(projectPath) {
  const matrix = await readCompatibility();
  const environment = await collectEnvironment(projectPath);

  return {
    product: "visp-dev",
    published: matrix.published,
    installed: { kit: environment.kit, hyper: environment.hyper, node: environment.node },
    supported: supportedPair(matrix),
    pairs: matrix.pairs.map((pair) => ({
      id: pair.id,
      kit: pair.kit.commit,
      hyper: pair.hyper.commit,
      negotiated: pair.negotiated
    }))
  };
}

export async function init(projectPath) {
  const report = await doctor(projectPath);
  const steps = [];

  if (!report.install.installable) {
    // Guide rather than install. This is the honest behaviour while the only
    // published versions are deprecated: an installer that silently fetched
    // them would hand the user a build with known policy-bypass defects.
    steps.push({
      kind: "blocked",
      title: "No supported release is available to install",
      detail: report.install.reason,
      commands: []
    });
  }

  if (report.pair !== null) {
    steps.push({
      kind: "manual",
      title: "Obtain the supported pair from source",
      detail: `Kit ${report.pair.kit.commit} and Hyper ${report.pair.hyper.commit}, which negotiate WorkflowAction ${report.pair.negotiated}.`,
      commands: [
        `git checkout ${report.pair.kit.commit}   # in visp-kit, then: pnpm build`,
        `git checkout ${report.pair.hyper.commit}   # in visp-hyper-agent, then: pnpm build`
      ]
    });
  }

  for (const step of report.recovery) {
    steps.push({ kind: "recovery", title: step, detail: null, commands: [] });
  }

  steps.push({
    kind: "next",
    title: "Once Kit and Hyper are on PATH, initialise the project",
    detail: "Kit owns the workflow; visp-dev does not wrap it.",
    commands: ["visp init .", "visp scan .", "visp next ."]
  });

  return { status: report.status, steps, doctor: report };
}

export function formatDoctor(report) {
  const lines = [`visp-dev doctor: ${report.status}`, ""];

  for (const check of report.checks) {
    lines.push(`  [${check.status}] ${check.name}: ${check.value}`);
    if (check.detail) lines.push(`        ${check.detail}`);
  }

  if (report.recovery.length > 0) {
    lines.push("", "Recovery:", ...report.recovery.map((item) => `  - ${item}`));
  }

  return lines.join("\n");
}

export function formatInit(result) {
  const lines = [`visp-dev init: ${result.status}`, ""];

  for (const step of result.steps) {
    lines.push(`  ${step.title}`);
    if (step.detail) lines.push(`    ${step.detail}`);
    for (const command of step.commands) lines.push(`    $ ${command}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function formatVersions(result) {
  const lines = [
    `visp-dev`,
    `  published release: ${result.published ? "yes" : "none"}`,
    `  installed kit:     ${result.installed.kit ?? "not installed"}`,
    `  installed hyper:   ${result.installed.hyper ?? "not installed"}`,
    `  node:              ${result.installed.node}`,
    "",
    "  supported pairs (pinned by commit, never by version range):"
  ];

  for (const pair of result.pairs) {
    lines.push(
      `    ${pair.id.padEnd(9)} kit ${pair.kit.slice(0, 7)}  hyper ${pair.hyper.slice(0, 7)}  protocol ${pair.negotiated}`
    );
  }

  return lines.join("\n");
}
