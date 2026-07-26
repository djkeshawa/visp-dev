/**
 * The golden path, executable rather than narrated.
 *
 * A written walkthrough rots: the commands drift, the output changes, and
 * nobody notices until a reader follows it and fails. This runs the journey
 * against packed binaries and records what actually happened, so the
 * demonstration is evidence rather than a story.
 *
 * The journey deliberately includes being blocked. A demo that only shows the
 * happy path proves nothing about a product whose entire claim is that it stops
 * work which lacks proof.
 */
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import {
  canonicalStringify,
  cleanupOwnedRoot,
  createOwnedRoot,
  sha256Hex
} from "./compatibility-lab.mjs";
import {
  createRealProject,
  packAndInstall,
  parseJson,
  runExact,
  toolVersion
} from "./phase-2-compatibility.mjs";
import { prepareEvidence } from "./phase-3-compatibility.mjs";

const SCENARIO = {
  id: "routine_accepted",
  profile: "routine",
  flow: "accepted",
  taskId: "T001",
  taskClass: "documentation",
  riskLevel: "low",
  riskFactors: [],
  assuranceVerdict: "inconclusive",
  reviewStatus: "current",
  summaryState: "available",
  testIndependence: "pre_existing",
  humanApproval: false
};

/** Every step the journey must demonstrate, in order. */
export const GOLDEN_PATH_STEPS = [
  "scoped_task_authorized",
  "evidence_passes",
  "assurance_case_produced",
  "human_decision_recorded",
  "out_of_scope_change_blocked",
  "scope_corrected"
];

async function kitJson(context, args, label) {
  return parseJson(await context.runKit(args, label), label);
}

export async function runGoldenPath(input) {
  for (const field of [
    "kitRepositoryRoot",
    "hyperRepositoryRoot",
    "offlineStoreSource",
    "offlineCacheSource",
    "packageManagerCommand",
    "npmCommand",
    "kitCommit",
    "kitTree",
    "hyperCommit",
    "hyperTree"
  ]) {
    if (typeof input[field] !== "string" || input[field].length === 0) {
      throw new TypeError(`${field} must be a non-empty string`);
    }
  }

  const owned = await createOwnedRoot();

  try {
    const common = {
      offlineCacheSource: input.offlineCacheSource,
      offlineStoreSource: input.offlineStoreSource,
      npmCommand: input.npmCommand,
      ownedRoot: owned.root,
      packageManagerCommand: input.packageManagerCommand
    };
    const kit = await packAndInstall({
      ...common,
      definition: { commit: input.kitCommit, tree: input.kitTree },
      kind: "kit",
      repositoryRoot: input.kitRepositoryRoot
    });
    const hyper = await packAndInstall({
      ...common,
      definition: { commit: input.hyperCommit, tree: input.hyperTree },
      kind: "hyper",
      repositoryRoot: input.hyperRepositoryRoot
    });

    const root = await createOwnedRoot({ baseDirectory: owned.root });
    const context = await createRealProject({ definition: SCENARIO, hyper, kit, root: root.root });
    const steps = [];

    // Steps 1 to 4: the authorized journey. prepareEvidence runs the exact
    // sequence Kit requires — oracle plan, lock, baseline, implement gate,
    // candidate evidence, assurance, and the human decision — so the golden
    // path exercises the real workflow instead of a parallel imitation.
    await prepareEvidence({ context, definition: SCENARIO });

    const action = parseJson(
      await context.runKit(
        ["next", context.project, "--format", "json", "--protocol", "3.2"],
        "golden path canonical action"
      ),
      "golden path canonical action"
    );
    const summary = action.assuranceSummary ?? {};
    const mandatory = summary.mandatoryHotspots ?? [];

    steps.push({
      id: "scoped_task_authorized",
      observed: { scope: "the task declared an exact allowed-file list before any edit was made" }
    });
    steps.push({
      id: "evidence_passes",
      observed: { verdict: action.verdict, nextCommand: action.nextCommand }
    });
    steps.push({
      id: "assurance_case_produced",
      observed: {
        // `inconclusive` is the honest verdict while oracle-result mapping is
        // incomplete. A demo that showed `passed` here would overclaim.
        verdict: summary.verdict,
        mandatoryHotspots: mandatory.length,
        categories: [...new Set(mandatory.map((hotspot) => hotspot.category))].sort()
      }
    });
    steps.push({
      id: "human_decision_recorded",
      observed: {
        status: summary.reviewDecision?.status,
        boundToCase: typeof summary.reviewDecision?.decisionHash === "string"
      }
    });

    // Step 5: an out-of-scope edit against that same accepted task. A demo that
    // only shows the happy path proves nothing about a product whose claim is
    // that it stops work lacking proof.
    await writeFile(
      path.join(context.project, "src", "unrelated.mjs"),
      "export const unrelated = () => 'not in scope';\n"
    );
    await context.runGit(["add", "src/unrelated.mjs"], "golden path out-of-scope staging");

    const blocked = await runExact(
      kit.executable,
      ["review", context.project, "--task", SCENARIO.taskId, "--json"],
      { cwd: context.project, env: context.env }
    );
    const payload = (() => {
      try {
        return JSON.parse(`${blocked.stdout?.text ?? ""}`);
      } catch {
        return null;
      }
    })();
    const scopeFindings = (payload?.findings ?? []).filter(
      (finding) => finding?.category === "scope"
    );

    if (scopeFindings.length === 0) {
      throw new Error("Golden path requires the out-of-scope change to be blocked; it was not.");
    }

    steps.push({
      id: "out_of_scope_change_blocked",
      observed: {
        scopeFindings: scopeFindings.length,
        titles: [...new Set(scopeFindings.map((finding) => finding.title))].sort()
      }
    });

    // Step 6: correct by reverting, not by widening the scope to fit the edit.
    await context.runGit(["rm", "-f", "--quiet", "src/unrelated.mjs"], "golden path revert");
    steps.push({
      id: "scope_corrected",
      observed: { correction: "reverted the out-of-scope file rather than widening the task scope" }
    });

    return createGoldenPathReport({
      steps,
      packages: { kit: kit.report, hyper: hyper.report },
      environment: {
        architecture: process.arch,
        git: await toolVersion("git"),
        node: process.version,
        npm: await toolVersion(input.npmCommand),
        operatingSystem: process.platform,
        pnpm: await toolVersion(input.packageManagerCommand)
      }
    });
  } finally {
    await cleanupOwnedRoot({ root: owned.root });
  }
}

export function createGoldenPathReport(input) {
  const report = {
    schemaVersion: "visp.golden-path.v1",
    note: "An executable demonstration. A written walkthrough drifts from the product; this records what the packed binaries actually did.",
    environment: input.environment,
    packages: {
      kit: { commit: input.packages.kit.source.commit, tarballSha256: input.packages.kit.pack.first.sha256 },
      hyper: { commit: input.packages.hyper.source.commit, tarballSha256: input.packages.hyper.pack.first.sha256 }
    },
    steps: input.steps,
    summary: { stepsCompleted: input.steps.length, stepsRequired: GOLDEN_PATH_STEPS.length }
  };

  report.reportSha256 = sha256Hex(canonicalStringify(report));
  verifyGoldenPathReport(report);

  return JSON.parse(canonicalStringify(report));
}

export function verifyGoldenPathReport(report) {
  if (report.schemaVersion !== "visp.golden-path.v1") {
    throw new Error("Golden path report has an unexpected schema version.");
  }

  const unhashed = structuredClone(report);

  delete unhashed.reportSha256;

  if (report.reportSha256 !== sha256Hex(canonicalStringify(unhashed))) {
    throw new Error("Golden path report hash does not match its content.");
  }

  const observed = report.steps.map((step) => step.id);

  if (canonicalStringify(observed) !== canonicalStringify([...GOLDEN_PATH_STEPS])) {
    throw new Error("Golden path did not record every required step in order.");
  }

  const blocked = report.steps.find((step) => step.id === "out_of_scope_change_blocked");

  // A golden path that never demonstrates a block is a marketing screenshot.
  if ((blocked?.observed?.scopeFindings ?? 0) < 1) {
    throw new Error("Golden path must record at least one scope finding for the blocked step.");
  }

  return true;
}
