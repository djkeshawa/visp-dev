/**
 * Whether a Visp release can be obtained today, and what to run if not.
 *
 * Reads `compatibility.json`, which is hand-maintained and test-guarded — its
 * generator is gone. This module ships to users; it decides no gate and holds
 * no state.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compareVersions, isNewerThan } from "./version-order.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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
    return {
      installable: false,
      reason:
        `The evidenced pair has been superseded on the registry. npm currently serves ` +
        `visp-kit@${npm["visp-kit"]} and visp-hyper-agent@${npm["visp-hyper-agent"]}. ` +
        `This matrix has not re-run its evidence pipeline against that pair, so it makes ` +
        `no support claim about it — and it will not recommend the older pair it did prove.`,
      guidance: [
        supersededAction(npm, environment),
        "This matrix makes no support claim about that pair; it is what the README recommends.",
        registry.hazard ?? "Do not install the superseded pair alongside the current one."
      ].join(" ")
    };
  }

  return {
    installable: false,
    reason:
      matrix.published === true
        ? "Registry packages exist, but no release is supported by the complete candidate, published-pair, and same-run platform evidence yet."
        : "No supported release is published. The only Visp versions on npm are deprecated and predate this compatibility matrix, so installing from the registry would obtain a build that is not supported.",
    guidance: "Build Kit and Hyper from source at the pinned commits below, or wait for a release."
  };
}

const REGISTRY_PACKAGES = Object.freeze(["visp-kit", "visp-hyper-agent"]);

/** The installed version of each package the registry serves, or null. */
function installedPair(environment) {
  return {
    "visp-kit": environment?.kit ?? null,
    "visp-hyper-agent": environment?.hyper ?? null
  };
}

/**
 * What to do about a pair the registry has moved past — the one line a reader
 * acts on, and the one the verdict above has to agree with.
 *
 * `visp-dev --help` promises the exact next command, so every branch here names
 * an action. Which action depends on what is already installed, and getting
 * that wrong has cost readers twice:
 *
 *   - Recommending versions already present read as "this tool does not know
 *     what is on my machine", which is the one thing it exists to know.
 *   - LC-111 defect 3: on a machine running 0.6.0 and 0.9.0 it printed `npm
 *     install -g visp-kit@0.5.0 visp-hyper-agent@0.8.0`. The verdict was "this
 *     matrix makes no support claim about what you have" and the advice was
 *     "downgrade to something it makes no support claim about either" — a
 *     recovery contradicting its own verdict, at the cost of a working install.
 */
function supersededAction(npm, environment) {
  const installed = installedPair(environment);
  const served = REGISTRY_PACKAGES.map((name) => `${name}@${npm[name]}`);

  if (environment !== undefined && REGISTRY_PACKAGES.every((name) => installed[name] === npm[name])) {
    return `You already have that pair installed (${served.join(", ")}); nothing needs installing.`;
  }

  const ahead = REGISTRY_PACKAGES.filter((name) => isNewerThan(installed[name], npm[name]));

  if (ahead.length > 0) {
    const running = ahead.map((name) => `${name}@${installed[name]}`).join(" and ");
    return (
      `You are running ${running}, newer than what npm serves (${served.join(", ")}); ` +
      `installing the registry pair would downgrade ${ahead.length > 1 ? "them" : "it"}, so this ` +
      `matrix does not ask you to. Run visp-dev versions to see the pairs it does hold evidence for.`
    );
  }

  return `To install what npm currently serves: npm install -g ${served.join(" ")}`;
}

/**
 * The lowest Node version any pair in this matrix requires.
 *
 * Doctor needs a Node requirement whether or not a pair is recommended for
 * install: those are two different questions, and answering the Node one only
 * when the other happened to succeed is what made a perfectly good Node 26
 * report as `[unknown]` (LC-111 defect 1). Returns null only when the matrix
 * states no requirement at all.
 */
export function matrixNodeFloor(matrix) {
  const floors = Array.isArray(matrix.pairs)
    ? matrix.pairs.map((pair) => pair.node).filter(Boolean)
    : [];

  return floors.length === 0
    ? null
    : floors.reduce((lowest, candidate) =>
        (compareVersions(candidate, lowest) ?? 0) < 0 ? candidate : lowest
      );
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
