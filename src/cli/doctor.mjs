/**
 * What this machine can and cannot do, reported rather than fixed.
 *
 * Nothing here installs anything. Every check says what was observed and, when
 * that is a problem, exactly one command that changes it.
 */
import { collectEnvironment, nodeSatisfies } from "./environment.mjs";
import {
  deprecatedInstallRecovery,
  installability,
  readCompatibility,
  releaseInstallRecovery,
  supportedNodeRanges,
  supportedPair,
} from "./installability.mjs";

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
