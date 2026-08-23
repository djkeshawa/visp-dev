/**
 * What this machine can and cannot do, reported rather than fixed.
 *
 * Nothing here installs anything. Every check says what was observed and, when
 * that is a problem, exactly one command that changes it.
 */
import { collectEnvironment } from "./environment.mjs";
import {
  deprecatedInstallRecovery,
  installability,
  matrixNodeFloor,
  readCompatibility,
  releaseInstallRecovery,
  supportedPair,
  unreadableNodeRequirements
} from "./installability.mjs";
import { satisfiesFloor } from "./version-order.mjs";

/**
 * What the verdict means, in the reader's terms.
 *
 * `unknown` and `blocked` are deliberately separate (LC-111 defect 2). Every
 * binary a user can install reports `unverified`, because the matrix pins its
 * pairs by commit and a binary on PATH does not report one — so folding
 * `unverified` into `blocked` made doctor a gate that could only ever say no,
 * including to a correct installation. Absence still blocks; a deprecated build
 * still fails. Having no evidence about a present pair is a third answer, and
 * it is not a refusal.
 */
const STATUS_MEANING = Object.freeze({
  ok: "this machine matches a pair the matrix holds evidence for",
  unknown:
    "nothing is wrong here; the matrix simply holds no evidence about the versions installed",
  blocked: "a component Visp needs is not reachable from this shell",
  failed: "something on this machine has to change before Visp will work"
});

/** The overall verdict. Order matters: the worst answer any check gave wins. */
export function overallStatus(checks) {
  const has = (...statuses) => checks.some((check) => statuses.includes(check.status));

  if (has("failed", "deprecated")) return "failed";
  if (has("unavailable")) return "blocked";
  if (has("unknown", "unverified")) return "unknown";
  return "ok";
}

/**
 * The Node row, answered from the matrix's own floor rather than from whether a
 * pair happens to be recommended.
 *
 * Those were conflated, so a machine on Node v26.7.0 was told `[unknown] … no
 * supported pair (the pairs in this matrix require >=22)` — a stated
 * requirement its Node plainly cleared, printed as if it were the reason for a
 * refusal that was really about Kit and Hyper.
 */
/**
 * Why there is no floor to judge against — which is two different situations.
 *
 * A matrix that asks nothing and a matrix asking something this tool cannot
 * read both leave the row `unknown`, but only one of them is "no requirement".
 * Telling a user on Node 26 that a matrix of `<25` states no Node requirement
 * withholds the only fact they could have acted on, so the values are named.
 */
function noFloorDetail(matrix) {
  const unreadable = unreadableNodeRequirements(matrix);

  return unreadable.length === 0
    ? "this matrix states no Node requirement"
    : `this matrix states Node requirements this tool cannot read as a floor ` +
      `(${unreadable.join(", ")}), so it will not guess one; check them by hand`;
}

export function nodeCheck(matrix, pair, nodeVersion) {
  const requirement = pair?.node ?? matrixNodeFloor(matrix);
  const satisfied = requirement === null ? null : satisfiesFloor(nodeVersion, requirement);

  return {
    name: "Node",
    value: nodeVersion,
    status: satisfied === null ? "unknown" : satisfied ? "ok" : "failed",
    detail:
      requirement === null
        ? noFloorDetail(matrix)
        : pair === null
          ? `every pair in this matrix requires Node ${requirement}; whether any pair is ` +
            `recommended for install is a separate question, answered below`
          : `requires ${requirement}`,
    requirement
  };
}

/** The other installation of the same product, when PATH carries two. */
export function conflictDetail(resolution) {
  const others = resolution.candidates.filter((candidate) => candidate.path !== resolution.path);

  return others
    .map((candidate) => `also on PATH: ${candidate.command} ${candidate.version} at ${candidate.path}`)
    .join("; ");
}

export function conflictRecovery(name, resolution) {
  const listed = resolution.candidates
    .map((candidate) => `${candidate.command} ${candidate.version} (${candidate.path})`)
    .join(" and ");

  return (
    `PATH carries two installations of ${name}: ${listed}. Your shell runs ` +
    `${resolution.command} ${resolution.version}, so every version reported here is that one. ` +
    `Remove one installation, or reorder PATH, so the two cannot disagree.`
  );
}

/** One product's row, and whatever the user has to do about it. */
function productCheck({ name, packageName, resolution, matrix, install }) {
  const value = resolution.version;
  const deprecated = (matrix.deprecated ?? []).find(
    (entry) => entry.name === packageName && entry.version === value
  );
  const recovery = [];

  if (deprecated !== undefined) recovery.push(deprecatedInstallRecovery(packageName, value, install));
  if (resolution.conflict) recovery.push(conflictRecovery(packageName, resolution));

  const check = {
    name,
    // "not found on PATH" is what was actually observed. Resolution walks PATH
    // and runs what it finds, so absence means unreachable from this shell —
    // not that the package is missing from the machine. A user who installed
    // under a prefix not on PATH was previously told a falsehood about their disk.
    value: value ?? "not found on PATH",
    // The resolved path, so a version and the file it came from can never be
    // read as describing two different installations (LC-95).
    path: resolution.path,
    // Present is not the same as correct. A detected binary cannot be matched to
    // the supported pair, because the pair is pinned by commit and a binary on
    // PATH does not report one. Saying "ok" here would bless an unknown build —
    // and if it is one of the deprecated versions, it is the defective build
    // this product exists to prevent people running.
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
        : [
            deprecated !== undefined
              ? `${packageName}@${value} is deprecated and unsupported. ${deprecated.reason}`
              : "detected on PATH, but cannot be matched to the supported pair, which is pinned by commit",
            resolution.conflict ? conflictDetail(resolution) : ""
          ]
            .filter(Boolean)
            .join(" — ")
  };

  return { check, recovery };
}

function gitCheck(environment) {
  return {
    name: "Git",
    value: environment.git ?? "not found",
    status: environment.git === null ? "failed" : "ok",
    detail: environment.gitRepository ? "project is a Git repository" : "project is not a Git repository"
  };
}

/**
 * The report, from facts already gathered.
 *
 * Kept separate from `doctor` so every state a user can be in — a Node below
 * the floor, a deprecated build, two installations of one product on PATH —
 * can be driven directly rather than only by arranging a machine that has it.
 * The states worth testing are exactly the ones nobody's machine is in.
 */
export function doctorReport({ matrix, pair, environment, install }) {
  const checks = [];
  const recovery = [];

  const node = nodeCheck(matrix, pair, environment.node);
  checks.push(node);
  if (node.status === "failed") {
    recovery.push(`Install Node ${node.requirement}, then re-run visp-dev doctor.`);
  }

  checks.push(gitCheck(environment));
  if (environment.git === null) recovery.push("Install Git; Visp records evidence against commits.");
  if (!environment.gitRepository) recovery.push("Run git init in the project; evidence is bound to commits.");

  for (const [name, packageName, resolution] of [
    ["Visp Kit", "visp-kit", environment.resolved.kit],
    ["Visp Hyper Agent", "visp-hyper-agent", environment.resolved.hyper]
  ]) {
    const product = productCheck({ name, packageName, resolution, matrix, install });
    checks.push(product.check);
    recovery.push(...product.recovery);
  }

  recovery.push(...releaseInstallRecovery(install, environment));

  const status = overallStatus(checks);

  return {
    status,
    statusReason: STATUS_MEANING[status],
    checks,
    recovery,
    pair,
    registryState: matrix.registryState ?? null,
    supportedRelease: pair === null ? null : matrix.supportedRelease,
    install,
    environment
  };
}

export async function doctor(projectPath) {
  const matrix = await readCompatibility();
  const environment = await collectEnvironment(projectPath);

  return doctorReport({
    matrix,
    pair: supportedPair(matrix),
    environment,
    install: installability(matrix, environment)
  });
}
