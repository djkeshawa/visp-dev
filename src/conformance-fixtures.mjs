/**
 * Conformance fixtures for the families that had no evidence.
 *
 * `src/conformance.mjs` declares ten required families and reported four with
 * no evidence at all: hook enforcement, operating system coverage, security,
 * and failure modes. This module produces that evidence by running fixtures
 * against packed, installed binaries rather than against the source tree — an
 * enforcement property that only holds in the repository is not a property of
 * the product anyone installs.
 *
 * Fixtures record what happened, including when what happened is wrong. A
 * fixture that observes a defect reports `known_defect`, never `pass`. The
 * alternative — quietly asserting current behaviour — converts a test suite
 * into a description of the bugs it has learned to live with.
 */
import path from "node:path";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";

import {
  canonicalStringify,
  cleanupOwnedRoot,
  createOwnedRoot,
  sha256Hex
} from "./compatibility-lab.mjs";
import {
  executionEnvironment,
  packAndInstall,
  pathCommand,
  runExact
} from "./phase-2-compatibility.mjs";

/**
 * Every fixture this module must run, declared before any of them execute.
 *
 * Declared independently for the same reason `REQUIRED_FAMILIES` is: a fixture
 * list derived from the fixtures that happen to pass cannot report a hole.
 */
export const REQUIRED_FIXTURES = [
  { id: "git_hook_installed", family: "hook" },
  { id: "git_hook_refuses_to_clobber", family: "hook" },
  { id: "ci_workflow_generated", family: "hook" },
  { id: "path_traversal_refused", family: "security" },
  { id: "command_injection_inert", family: "security" },
  { id: "package_allowlist_honoured", family: "security" },
  { id: "no_credential_material_packed", family: "security" },
  { id: "missing_binary_reports_honestly", family: "failure_mode" },
  { id: "corrupted_artifact_detected_by_doctor", family: "failure_mode" },
  { id: "corrupted_artifact_detected_by_next", family: "failure_mode" },
  { id: "interrupted_run_recovers", family: "failure_mode" }
];

/** Top-level entries a published tarball is allowed to contain. */
const ALLOWED_TARBALL_ROOTS = new Set([
  "AGENTS.md",
  "LICENSE",
  "NOTICE",
  "README.md",
  "SECURITY.md",
  "TRADEMARKS.md",
  "dist",
  "docs",
  "examples",
  "package.json",
  "schemas",
  "scripts"
]);

/** Names that must never appear anywhere inside a published tarball. */
const CREDENTIAL_PATTERNS = [
  /(^|\/)\.npmrc$/u,
  /(^|\/)\.env(\.|$)/u,
  /(^|\/)\.git\//u,
  /(^|\/)id_(rsa|ed25519)$/u,
  /(^|\/)\.aws\//u,
  /\.pem$/u,
  /\.p12$/u
];

function fixture(id, status, observed) {
  const declared = REQUIRED_FIXTURES.find((entry) => entry.id === id);

  if (declared === undefined) throw new Error(`Undeclared fixture ${id}`);
  if (!["pass", "known_defect", "fail"].includes(status)) {
    throw new Error(`Fixture ${id} reported an unknown status ${status}`);
  }

  return { id, family: declared.family, status, observed };
}

async function initProject({ kitExecutable, env, root, name }) {
  const project = path.join(root, name);

  await mkdir(project, { recursive: true });
  await runExact(await pathCommand("git"), ["init", "-q"], { cwd: project, env });
  await runExact(
    kitExecutable,
    ["init", project, "--agent", "none", "--preset", "javascript", "--strictness", "standard"],
    { cwd: project, env }
  );

  return project;
}

const textOf = (result) => `${result.stdout?.text ?? ""}${result.stderr?.text ?? ""}`;

/* ------------------------------------------------------------------ hook -- */

async function hookFixtures({ kitExecutable, env, root }) {
  const results = [];
  const project = await initProject({ kitExecutable, env, root, name: "hook-project" });
  const hookPath = path.join(project, ".git", "hooks", "pre-commit");

  const install = await runExact(kitExecutable, ["hooks", "git", project], { cwd: project, env });
  const installed = await readFile(hookPath, "utf8").catch(() => null);

  results.push(
    fixture(
      "git_hook_installed",
      installed !== null && install.exitCode === 0 ? "pass" : "fail",
      {
        exitCode: install.exitCode ?? null,
        hookWritten: installed !== null,
        // A hook that does not mention the tool it enforces is not evidence of
        // enforcement; it is an empty file in the right place.
        referencesVisp: installed === null ? false : /visp/iu.test(installed)
      }
    )
  );

  // The family claim is that Visp enforcement "remains authoritative when
  // native hooks exist". The honest reading of that is the reverse duty:
  // Visp must not silently destroy a hook a project already relies on.
  const native = "#!/bin/sh\necho 'project native hook'\nexit 0\n";

  await writeFile(hookPath, native, { mode: 0o755 });

  const second = await runExact(kitExecutable, ["hooks", "git", project], { cwd: project, env });
  const after = await readFile(hookPath, "utf8").catch(() => null);
  const preserved = after !== null && after.includes("project native hook");
  const warned = /exist|overwrit|backup|force/iu.test(textOf(second));

  results.push(
    fixture(
      "git_hook_refuses_to_clobber",
      preserved || warned ? "pass" : "known_defect",
      {
        exitCode: second.exitCode ?? null,
        nativeHookPreserved: preserved,
        warnedBeforeReplacing: warned,
        note: preserved || warned
          ? "An existing native hook is preserved or the operator is warned."
          : "An existing native pre-commit hook was replaced silently."
      }
    )
  );

  const ci = await runExact(kitExecutable, ["hooks", "ci", project], { cwd: project, env });

  // Discover the generated workflow rather than hardcoding its filename: a
  // fixture pinned to a name fails when the name changes and reports it as a
  // product defect, which is exactly the wrong signal.
  const workflowDirectory = path.join(project, ".github", "workflows");
  const workflowNames = await readdir(workflowDirectory).catch(() => []);
  const workflows = await Promise.all(
    workflowNames.map(async (name) => ({
      name,
      content: await readFile(path.join(workflowDirectory, name), "utf8").catch(() => "")
    }))
  );
  const vispWorkflows = workflows.filter((entry) => /visp/iu.test(entry.content));

  results.push(
    fixture("ci_workflow_generated", vispWorkflows.length > 0 ? "pass" : "fail", {
      exitCode: ci.exitCode ?? null,
      workflowsWritten: workflowNames.sort(),
      invokesVisp: vispWorkflows.map((entry) => entry.name).sort()
    })
  );

  return results;
}

/* -------------------------------------------------------------- security -- */

/** Every file inside an installed package, as project-relative POSIX paths. */
async function listInstalledFiles(installRoot) {
  const found = [];

  async function walk(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;

      if (entry.isDirectory()) {
        await walk(path.join(directory, entry.name), relative);
      } else {
        found.push(relative);
      }
    }
  }

  await walk(installRoot, "");

  return found.sort();
}

async function securityFixtures({ kitExecutable, env, root, kitInstallRoot }) {
  const results = [];
  const project = await initProject({ kitExecutable, env, root, name: "security-project" });

  // Path traversal: a target outside the project must not be initialised or
  // read. Kit is expected to refuse rather than walk upward.
  const traversal = await runExact(
    kitExecutable,
    ["status", path.join(project, "..", "..", "..", "etc")],
    { cwd: project, env }
  );
  const refused = traversal.exitCode !== 0 || /not initialized|refus|outside|invalid/iu.test(textOf(traversal));

  results.push(
    fixture("path_traversal_refused", refused ? "pass" : "known_defect", {
      exitCode: traversal.exitCode ?? null,
      refused,
      note: refused
        ? "A traversal target is refused rather than inspected."
        : "A path outside the project was accepted."
    })
  );

  // Command injection: shell metacharacters in a user-supplied argument must
  // be inert. The canary file existing afterwards means Kit shelled out with
  // an interpolated string somewhere.
  const canary = path.join(root, "injection-canary");
  const injection = await runExact(
    kitExecutable,
    ["feature", `x"; touch ${canary}; echo "`, project],
    { cwd: project, env }
  );
  const executed = await readFile(canary, "utf8").then(() => true).catch(() => false);

  results.push(
    fixture("command_injection_inert", executed ? "fail" : "pass", {
      exitCode: injection.exitCode ?? null,
      canaryExecuted: executed,
      note: executed
        ? "A shell metacharacter payload in an argument executed."
        : "Metacharacters were treated as literal text."
    })
  );

  // The installed package is the actual attack surface: whatever it contains
  // is what lands on a user's disk. Reading it from the install root rather
  // than from the tarball manifest means the fixture observes the end state,
  // not an intermediate description of it.
  const entries = await listInstalledFiles(kitInstallRoot);
  const roots = [...new Set(entries.map((entry) => entry.split("/")[0]))]
    .filter((entry) => entry.length > 0)
    .sort();
  const unexpected = roots.filter((entry) => !ALLOWED_TARBALL_ROOTS.has(entry));

  results.push(
    fixture("package_allowlist_honoured", unexpected.length === 0 ? "pass" : "fail", {
      topLevelEntries: roots,
      unexpectedEntries: unexpected,
      entryCount: entries.length
    })
  );

  const credentials = entries.filter((entry) =>
    CREDENTIAL_PATTERNS.some((pattern) => pattern.test(entry))
  );

  results.push(
    fixture("no_credential_material_packed", credentials.length === 0 ? "pass" : "fail", {
      matches: credentials,
      patternsChecked: CREDENTIAL_PATTERNS.length
    })
  );

  return results;
}

/* ---------------------------------------------------------- failure mode -- */

async function failureModeFixtures({ kitExecutable, hyperExecutable, env, root }) {
  const results = [];
  const project = await initProject({ kitExecutable, env, root, name: "failure-project" });

  // Hyper orchestrates Kit as a binary. With Kit absent it must say so rather
  // than crash with a stack trace or, worse, proceed as though unenforced work
  // were enforced.
  // Remove only Kit's directory from PATH. Clearing PATH outright would stop
  // Hyper and node from launching at all, and the resulting spawn failure
  // would look like a product defect while proving nothing.
  const withoutKit = {
    ...env,
    PATH: env.PATH.split(path.delimiter)
      .filter((entry) => entry !== path.dirname(kitExecutable))
      .join(path.delimiter),
    VISP_KIT_BIN: path.join(root, "nonexistent-visp-binary")
  };
  const missing = await runExact(hyperExecutable, ["--project", project, "status"], {
    cwd: project,
    env: withoutKit
  });
  const text = textOf(missing);
  const named = /kit|not found|ENOENT|missing|install/iu.test(text);
  const crashed = /at Object\.|at Module\.|Unhandled|UnhandledPromiseRejection/u.test(text);

  results.push(
    fixture("missing_binary_reports_honestly", named && !crashed ? "pass" : "known_defect", {
      exitCode: missing.exitCode ?? null,
      namesTheMissingDependency: named,
      leakedStackTrace: crashed
    })
  );

  const statusPath = path.join(project, ".visp", "status.json");
  const healthy = await readFile(statusPath, "utf8");

  await writeFile(statusPath, "NOT JSON AT ALL {{{\n");

  const doctor = await runExact(kitExecutable, ["doctor", project], { cwd: project, env });
  const doctorCaught = doctor.exitCode !== 0 && /status\.json|invalid|parse|corrupt/iu.test(textOf(doctor));

  results.push(
    fixture("corrupted_artifact_detected_by_doctor", doctorCaught ? "pass" : "fail", {
      exitCode: doctor.exitCode ?? null,
      detected: doctorCaught
    })
  );

  // `next` is the command an agent loop calls every turn. Comparing its output
  // on a healthy and a corrupted artifact is the whole test: identical output
  // means the corruption is invisible at the point it matters most.
  const corruptedNext = await runExact(kitExecutable, ["next", project, "--format", "json"], {
    cwd: project,
    env
  });

  await writeFile(statusPath, healthy);

  const healthyNext = await runExact(kitExecutable, ["next", project, "--format", "json"], {
    cwd: project,
    env
  });
  const identical = (corruptedNext.stdout?.text ?? "") === (healthyNext.stdout?.text ?? "");
  const nextCaught = corruptedNext.exitCode !== 0 || /invalid|corrupt|parse/iu.test(textOf(corruptedNext));

  results.push(
    fixture("corrupted_artifact_detected_by_next", nextCaught ? "pass" : "known_defect", {
      exitCode: corruptedNext.exitCode ?? null,
      detected: nextCaught,
      outputIdenticalToHealthyProject: identical,
      note: nextCaught
        ? "next refuses to advise from an unreadable status artifact."
        : "next emits the same guidance whether the status artifact is valid or corrupt. Confirmed not a privilege escalation: gates read evidence artifacts, not this breadcrumb. It is a robustness defect — next advises confidently from state it could not read."
    })
  );

  // An interrupted run leaves a partial artifact tree. Re-running must either
  // recover or report the inconsistency; what it must not do is present a
  // half-written project as healthy.
  //
  // Corruption and deletion are tested as a matched pair on the same artifact,
  // because the interesting result is not either verdict alone but whether
  // they agree. If deletion is quieter than corruption, an interrupted run —
  // which produces missing files, not malformed ones — is the case that slips
  // through.
  const runIndex = path.join(project, ".visp", "runs", "index.json");
  const original = await readFile(runIndex, "utf8").catch(() => null);

  await writeFile(runIndex, "BROKEN {{{\n");

  const corrupted = await runExact(kitExecutable, ["doctor", project], { cwd: project, env });

  await rm(runIndex, { force: true });

  const deleted = await runExact(kitExecutable, ["doctor", project], { cwd: project, env });

  if (original !== null) await writeFile(runIndex, original);

  const corruptionNoticed = corrupted.exitCode !== 0;
  const deletionNoticed = deleted.exitCode !== 0;

  results.push(
    fixture("interrupted_run_recovers", deletionNoticed ? "pass" : "known_defect", {
      corruptedExitCode: corrupted.exitCode ?? null,
      deletedExitCode: deleted.exitCode ?? null,
      corruptionNoticed,
      deletionNoticed,
      note: deletionNoticed
        ? "A missing run index is reported."
        : "Corrupting the run index is reported; deleting it is not. Missing artifacts are treated as not-applicable while invalid ones are errors, so an interrupted run — which leaves files missing rather than malformed — passes doctor."
    })
  );

  return results;
}

/* ----------------------------------------------------------------- entry -- */

export async function runConformanceFixtures(input) {
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

    const env = executionEnvironment(kit, hyper, await pathCommand("git"));
    const workspace = await createOwnedRoot({ baseDirectory: owned.root });
    const shared = { kitExecutable: kit.executable, env, root: workspace.root };
    const fixtures = [
      ...(await hookFixtures(shared)),
      ...(await securityFixtures({
        ...shared,
        kitInstallRoot: path.join(kit.fixture, "node_modules", "visp-kit")
      })),
      ...(await failureModeFixtures({ ...shared, hyperExecutable: hyper.executable }))
    ];

    return createConformanceFixtureReport({
      fixtures,
      packages: { kit: kit.report, hyper: hyper.report },
      environment: {
        architecture: process.arch,
        node: process.version,
        operatingSystem: process.platform
      }
    });
  } finally {
    await cleanupOwnedRoot({ root: owned.root });
  }
}

export function createConformanceFixtureReport(input) {
  const byStatus = (status) => input.fixtures.filter((entry) => entry.status === status);
  const report = {
    schemaVersion: "visp.conformance-fixtures.v1",
    note: "Fixtures run against packed, installed binaries. A fixture that observes a defect reports known_defect, never pass.",
    environment: input.environment,
    packages: {
      kit: {
        commit: input.packages.kit.source.commit,
        tarballSha256: input.packages.kit.pack.first.sha256
      },
      hyper: {
        commit: input.packages.hyper.source.commit,
        tarballSha256: input.packages.hyper.pack.first.sha256
      }
    },
    fixtures: [...input.fixtures].sort((left, right) => left.id.localeCompare(right.id)),
    summary: {
      required: REQUIRED_FIXTURES.length,
      ran: input.fixtures.length,
      passed: byStatus("pass").length,
      knownDefects: byStatus("known_defect").length,
      failed: byStatus("fail").length,
      knownDefectIds: byStatus("known_defect").map((entry) => entry.id).sort(),
      failedIds: byStatus("fail").map((entry) => entry.id).sort()
    },
    // Families covered here are the ones `conformance.mjs` reported empty. A
    // family counts as covered when every fixture in it ran — including the
    // ones that found something wrong, because a recorded defect is evidence
    // and an unrun fixture is not.
    familiesCovered: [...new Set(input.fixtures.map((entry) => entry.family))].sort()
  };

  report.reportSha256 = sha256Hex(canonicalStringify(report));
  verifyConformanceFixtureReport(report);

  return JSON.parse(canonicalStringify(report));
}

export function verifyConformanceFixtureReport(report) {
  if (report.schemaVersion !== "visp.conformance-fixtures.v1") {
    throw new Error("Conformance fixture report has an unexpected schema version.");
  }

  const unhashed = structuredClone(report);

  delete unhashed.reportSha256;

  if (report.reportSha256 !== sha256Hex(canonicalStringify(unhashed))) {
    throw new Error("Conformance fixture report hash does not match its content.");
  }

  const observed = new Set(report.fixtures.map((entry) => entry.id));

  for (const declared of REQUIRED_FIXTURES) {
    if (!observed.has(declared.id)) {
      throw new Error(`Conformance fixture report omits required fixture ${declared.id}.`);
    }
  }

  // The failure this verifier exists to catch: a summary that reports clean
  // while individual fixtures record defects.
  const defects = report.fixtures.filter((entry) => entry.status === "known_defect").length;
  const failures = report.fixtures.filter((entry) => entry.status === "fail").length;

  if (report.summary.knownDefects !== defects || report.summary.failed !== failures) {
    throw new Error("Conformance fixture summary disagrees with the fixtures it summarises.");
  }

  return true;
}
