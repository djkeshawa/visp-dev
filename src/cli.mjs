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
 * A historical pair is evidence, not a recommendation. Only the exact pair
 * named by supportedRelease is eligible for user-facing guidance.
 */
export function supportedPair(matrix) {
  const release = matrix.supportedRelease;

  if (
    release === null ||
    release === undefined ||
    matrix.releaseEvidence?.eligible !== true ||
    !Array.isArray(matrix.releaseEvidence.issues) ||
    matrix.releaseEvidence.issues.length !== 0 ||
    !Array.isArray(matrix.pairs)
  ) return null;

  return (
    matrix.pairs.find(
      (pair) => {
        const resolved = matrix.releaseEvidence.resolvedPackages;
        const anchored = (component, identity) =>
          component?.commit === identity?.commit &&
          component?.tree === identity?.tree &&
          component?.tarballSha256 === identity?.tarballSha256;

        // Matched by IDENTITY, never by phase name. This used to also require
        // `pair.id === "phase-6"`, which meant no later pair could ever be
        // recommended however good its evidence — a hardcoded ceiling on the
        // product's own future. The five-field anchoring below is what actually
        // establishes that the evidence describes this pair; the id is a label.
        return (
          resolved?.kit?.version === release.kit &&
          resolved?.hyper?.version === release.hyper &&
          anchored(pair.kit, resolved.kit) &&
          anchored(pair.hyper, resolved.hyper)
        );
      }
    ) ?? null
  );
}

/**
 * Whether a Visp release can be obtained today.
 *
 * `published: false` means nothing in the matrix corresponds to a registry
 * release. The versions that *are* on npm are deprecated and predate the whole
 * matrix, so directing anyone at them would hand them the defective build this
 * product exists to prevent.
 */
export function installability(matrix, environment = undefined) {
  const release = matrix.supportedRelease;
  const pair = supportedPair(matrix);

  if (matrix.published === true && release !== null && release !== undefined && pair !== null) {
    return {
      installable: true,
      reason: `A supported release is published: visp-kit@${release.kit} and visp-hyper-agent@${release.hyper}.`,
      guidance: `npm install -g visp-kit@${release.kit} visp-hyper-agent@${release.hyper}`
    };
  }

  // Superseded is a different situation from never-proven, and conflating them
  // produces actively harmful advice: it would point a user at an older pair
  // that now contends for the `visp` binary with what the registry serves.
  const registry = matrix.registryState;

  if (registry?.supersedesEvidencedPair === true) {
    const npm = registry.npm ?? {};
    // Guidance must be an ACTION. This previously returned only the hazard —
    // a sentence saying what not to install — while every other branch of this
    // function returns a real command, and while `visp-dev --help` promises to
    // tell you "the exact next command". Two independent evaluators followed
    // the recovery section and still did not know what to run. Withholding a
    // support claim is honest; withholding the command is just unhelpful.
    const install = `npm install -g visp-kit@${npm["visp-kit"]} visp-hyper-agent@${npm["visp-hyper-agent"]}`;
    // Do not recommend installing what is already installed.
    //
    // A weak-model evaluation followed this advice, ran `npm list -g`, and
    // found the exact versions already present. An instruction that changes
    // nothing reads as "the tool does not know what is on my machine", which
    // is worse than saying nothing — and this command's entire job is to know.
    const alreadyServing =
      environment !== undefined &&
      environment.kit === npm["visp-kit"] &&
      environment.hyper === npm["visp-hyper-agent"];
    return {
      installable: false,
      reason:
        `The evidenced pair has been superseded on the registry. npm currently serves ` +
        `visp-kit@${npm["visp-kit"]} and visp-hyper-agent@${npm["visp-hyper-agent"]}. ` +
        `This matrix has not re-run its evidence pipeline against that pair, so it makes ` +
        `no support claim about it — and it will not recommend the older pair it did prove.`,
      guidance: [
        alreadyServing
          ? `You already have that pair installed (visp-kit@${npm["visp-kit"]}, ` +
            `visp-hyper-agent@${npm["visp-hyper-agent"]}); nothing needs installing.`
          : `To install what npm currently serves: ${install}`,
        "This matrix makes no support claim about that pair; it is what the README recommends.",
        registry.hazard ?? "Do not install the superseded pair alongside the current one."
      ].join(" ")
    };
  }

  return {
    installable: false,
    reason:
      matrix.published === true
        ? "Registry packages exist, but no release is supported by the complete candidate, Phase 6, and same-run platform evidence yet."
        : "No supported release is published. The only Visp versions on npm are deprecated and predate this compatibility matrix, so installing from the registry would obtain a build that is not supported.",
    guidance: "Build Kit and Hyper from source at the pinned commits below, or wait for a release."
  };
}

/**
 * The Node versions the matrix knows about, as a readable suffix.
 *
 * `Node: v24.15.0 — no supported pair` named the problem and withheld every
 * fact that would let someone act on it. A weak-model evaluation stopped
 * there: it could not tell whether its Node was too new, too old, or simply
 * not the reason. Listing what the matrix does require turns a dead end into a
 * comparison the reader can make themselves.
 *
 * Returns "" when there is nothing to add, so the caller's sentence stays
 * grammatical either way.
 */
export function supportedNodeRanges(matrix) {
  if (!Array.isArray(matrix.pairs)) return "";
  const ranges = [...new Set(matrix.pairs.map((pair) => pair.node).filter(Boolean))];
  if (ranges.length === 0) return "";
  return ` (the pairs in this matrix require ${ranges.join(" or ")})`;
}

export function releaseInstallRecovery(install, environment) {
  const missingSupportedBinary = environment.kit === null || environment.hyper === null;

  return !install.installable || missingSupportedBinary ? [install.guidance] : [];
}

export function deprecatedInstallRecovery(packageName, version, install) {
  return install.installable
    ? `Uninstall ${packageName}@${version}; it is deprecated and unsupported. Then run: ${install.guidance}`
    : `Uninstall ${packageName}@${version}; it is deprecated and unsupported. ${install.guidance}`;
}

export async function collectEnvironment(projectPath) {
  const [node, npm, pnpm, git, kitRenamed, kitLegacy, hyper] = await Promise.all([
    Promise.resolve(process.version),
    detectTool("npm"),
    detectTool("pnpm"),
    detectTool("git"),
    // P10-US-04: Kit's binary is `visp-kit` from 0.4.0; `visp` is the
    // pre-rename Kit (or, post-cutover, the Hyper dispatcher — which is why
    // the renamed probe wins when both answer).
    detectTool("visp-kit"),
    detectTool("visp"),
    detectTool("visp-hyper")
  ]);

  // The `visp` fallback is only Kit on a PRE-RENAME machine.
  //
  // This used to read `kitRenamed ?? kitLegacy`, which was right until D-118
  // moved Kit to `visp-kit` and gave `visp` to Hyper. After that, a machine
  // with only the coordinator installed made the fallback find Hyper and report
  // its version as Kit's — doctor announcing an engine that is not there, and
  // then computing every recommendation from that invented fact. Doctor's whole
  // job is saying what is installed, so inventing a product is worse than
  // saying nothing: the user stops looking for the real problem.
  //
  // Dropping the fallback outright would be the other kind of wrong. Users on
  // Kit 0.2.3 still have a `visp` that genuinely IS Kit, and they are exactly
  // the people who need doctor to work.
  //
  // Neither binary names itself in `--version` (both print a bare number), so
  // identity comes from the one unambiguous name in the pair: `visp-hyper` is
  // Hyper and nothing else. Hyper ships both binaries from one package, so a
  // `visp` reporting the same version as `visp-hyper` IS that dispatcher.
  //
  // Residual edge, stated rather than hidden: a legacy Kit whose version string
  // happened to equal the installed Hyper's would be read as Hyper and reported
  // absent. That errs toward under-reporting — doctor would advise installing
  // something already present, which is harmless — rather than toward the
  // failure being fixed here, which asserts a product exists when it does not.
  const legacyIsHyperDispatcher = kitLegacy !== null && hyper !== null && kitLegacy === hyper;
  const kit = kitRenamed ?? (legacyIsHyperDispatcher ? null : kitLegacy);

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
  const install = installability(matrix, environment);
  const checks = [];
  const recovery = [];

  const nodeOk = pair === null ? null : nodeSatisfies(environment.node, pair.node);
  checks.push({
    name: "Node",
    value: environment.node,
    status: nodeOk === null ? "unknown" : nodeOk ? "ok" : "failed",
    detail:
      pair === null
        ? // "no supported pair" told the reader nothing they could act on. Name
          // the versions the matrix does know about, so they can see whether
          // their Node is the problem or merely unmentioned.
          `no supported pair${supportedNodeRanges(matrix)}`
        : `requires ${pair.node}`
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
      // "not found on PATH" is what was actually observed. detectTool spawns the
      // binary, so absence means unreachable from this shell — not that the
      // package is missing from the machine. A user who installed under a
      // prefix not on PATH was previously told a falsehood about their disk.
      value: value ?? "not found on PATH",
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
      recovery.push(deprecatedInstallRecovery(packageName, value, install));
    }
  }

  recovery.push(...releaseInstallRecovery(install, environment));

  // A deprecated build in use is a failure: it is the specific defect the
  // product exists to prevent, and reporting it as a warning would understate it.
  const status = checks.some((check) => ["failed", "deprecated"].includes(check.status))
    ? "failed"
    : checks.some((check) => ["unavailable", "unverified"].includes(check.status))
      ? "blocked"
      : "ok";

  return {
    status,
    checks,
    recovery,
    pair,
    registryState: matrix.registryState ?? null,
    supportedRelease: pair === null ? null : matrix.supportedRelease,
    install,
    environment
  };
}

export async function versions(projectPath) {
  const matrix = await readCompatibility();
  const environment = await collectEnvironment(projectPath);
  const pair = supportedPair(matrix);

  return {
    product: "visp-dev",
    published: matrix.published,
    registryState: matrix.registryState ?? null,
    supportedRelease: pair === null ? null : matrix.supportedRelease,
    installed: { kit: environment.kit, hyper: environment.hyper, node: environment.node },
    supported: pair,
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

/**
 * Why no release is named. A withheld recommendation after a registry
 * supersession is a different state from missing evidence, and saying
 * "incomplete" there would misdescribe evidence that is complete and valid.
 */
function noReleaseReason(report) {
  return report?.registryState?.supersedesEvidencedPair === true
    ? "none (evidenced pair superseded on the registry)"
    : "none (evidence incomplete)";
}

export function formatDoctor(report) {
  const release = report.supportedRelease ?? null;
  const lines = [
    // Say which question this answers.
    //
    // Three commands reported on one machine within a minute and disagreed:
    // `visp setup` said complete, `visp doctor` said FAIL, this said blocked.
    // A weak-model evaluation called it "unresolvable without knowing which
    // tool is authoritative". They were never in conflict — they answer
    // different questions — but none of them said so, which is what made the
    // disagreement look like a contradiction.
    "scope: machine and package compatibility (visp doctor covers the project)",
    `visp-dev doctor: ${report.status}`,
    `supported release: ${release === null ? noReleaseReason(report) : `visp-kit@${release.kit} + visp-hyper-agent@${release.hyper}`}`,
    ""
  ];

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
  const release = result.supportedRelease;
  const lines = [
    `visp-dev`,
    `  published release: ${result.published ? "yes" : "none"}`,
    `  supported release: ${release === null ? noReleaseReason(result) : `visp-kit@${release.kit} + visp-hyper-agent@${release.hyper}`}`,
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
