/**
 * How far the committed evidence lags the repositories it describes.
 *
 * Every frozen pair pins exact commits, which is what makes it evidence rather
 * than a claim. The cost is that the moment an engine repository moves, the
 * evidence quietly describes something older than what is checked out — and
 * nothing says so. Re-pinning on every commit is not the answer: a pin that
 * chases HEAD proves nothing, because it is never tested before it moves again.
 *
 * So this measures the lag instead of hiding it, and classifies it. A gap made
 * of documentation and test commits is not the same risk as a gap touching the
 * wire schema, and a reader deciding whether to trust the evidence needs to
 * know which one they have.
 */
import { canonicalStringify, sha256Hex } from "../../platform/canonical-json.mjs";
import { runProcess } from "../../toolchain/index.mjs";

/**
 * Paths whose movement invalidates a compatibility claim outright, in the order
 * they are reported. Declared rather than inferred: a heuristic that decided
 * risk by counting changed lines would rank a one-line schema edit below a
 * large documentation sweep.
 */
export const CRITICAL_PATHS = [
  { prefix: "schemas/", reason: "the WorkflowAction wire schema", severity: "invalidating" },
  { prefix: "src/integration/", reason: "the host integration surface", severity: "invalidating" },
  { prefix: "src/gates/", reason: "gate decisions", severity: "material" },
  { prefix: "src/policy/", reason: "policy resolution", severity: "material" },
  { prefix: "src/workflows/", reason: "workflow behaviour", severity: "material" },
  { prefix: "src/validators/", reason: "artifact validation", severity: "material" },
  // Added after this tool reported a real change to src/overrides/ as
  // unclassified. An override decides whether a gate passes, so it belongs
  // here; the orchestrator decides what `next` answers; assurance and evidence
  // decide the verdict a reviewer reads.
  { prefix: "src/overrides/", reason: "whether an override lets a gate pass", severity: "material" },
  { prefix: "src/orchestrator/", reason: "the next step Kit recommends", severity: "material" },
  { prefix: "src/assurance/", reason: "assurance verdicts and hotspots", severity: "material" },
  { prefix: "src/evidence/", reason: "evidence collection and comparison", severity: "material" }
];

/** Paths that cannot change observable behaviour for an integrator. */
const INERT_PREFIXES = ["tests/", "docs/", ".github/", "planning/"];
const INERT_FILES = [
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "NOTICE",
  "LICENSE",
  "SECURITY.md",
  "TRADEMARKS.md",
  "CODE_OF_CONDUCT.md"
];

/**
 * Files that are not source but decide what a user actually receives.
 *
 * `package.json` is the one people forget. It carries the `files` allowlist,
 * the `bin` mapping, the engines floor, and the dependency set — change any of
 * those and the installed package differs even though no source moved. It was
 * previously unclassified, which reported as "cannot tell" when the honest
 * answer is "this can change what ships".
 */
const MATERIAL_FILES = ["package.json"];

async function git(repositoryRoot, args) {
  const result = await runProcess("git", args, { cwd: repositoryRoot });

  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${repositoryRoot}`);
  }

  return `${result.stdout?.text ?? ""}`.trim();
}

function classify(paths) {
  const matched = [];

  for (const critical of CRITICAL_PATHS) {
    const hits = paths.filter((entry) => entry.startsWith(critical.prefix));

    if (hits.length > 0) matched.push({ ...critical, files: hits.length });
  }

  const manifestHits = paths.filter((entry) => MATERIAL_FILES.includes(entry));

  if (manifestHits.length > 0) {
    matched.push({
      prefix: "package.json",
      reason: "what the published package contains",
      severity: "material",
      files: manifestHits.length
    });
  }

  const inert = paths.every(
    (entry) => INERT_PREFIXES.some((prefix) => entry.startsWith(prefix)) || INERT_FILES.includes(entry)
  );

  if (matched.some((entry) => entry.severity === "invalidating")) return { risk: "invalidating", matched };
  if (matched.length > 0) return { risk: "material", matched };
  if (paths.length === 0) return { risk: "current", matched };
  if (inert) return { risk: "inert", matched };

  return { risk: "unclassified", matched };
}

/**
 * @param input.repositories  { name, root, pinnedCommit } per engine repository
 */
export async function measureEvidenceCurrency(input) {
  const repositories = [];

  for (const repository of input.repositories) {
    const head = await git(repository.root, ["rev-parse", "HEAD"]);
    const current = head === repository.pinnedCommit;
    const range = `${repository.pinnedCommit}..${head}`;
    const commitsBehind = current
      ? 0
      : Number.parseInt(await git(repository.root, ["rev-list", "--count", range]), 10);
    const changedPaths = current
      ? []
      : (await git(repository.root, ["diff", "--name-only", range]))
          .split("\n")
          .filter((entry) => entry.length > 0)
          .sort();
    const { risk, matched } = classify(changedPaths);

    repositories.push({
      name: repository.name,
      pinnedCommit: repository.pinnedCommit,
      headCommit: head,
      commitsBehind,
      changedFileCount: changedPaths.length,
      risk,
      criticalPathsTouched: matched.map(({ prefix, reason, severity, files }) => ({
        prefix,
        reason,
        severity,
        files
      }))
    });
  }

  return createEvidenceCurrencyReport({ evidence: input.evidenceName, repositories });
}

/**
 * What a risk level means, as a sentence.
 *
 * One definition because it is stated in two places — the report summary, and
 * the per-repository annotation LC-76 publishes on the pull request. They were
 * briefly the same string: every annotation carried the SUMMARY verdict, which
 * is the worst risk across all repositories, so a repository at `material` was
 * announced as having moved the wire schema. A reader would have concluded the
 * wrong repository broke the contract.
 */
export function evidenceCurrencyVerdict(risk) {
  switch (risk) {
    case "current":
      return "The evidence describes the checked-out repositories exactly.";
    case "inert":
      return "The repositories moved, but only in paths that cannot change integrator-observable behaviour.";
    case "material":
      return "The repositories moved in paths that can change behaviour. Re-run the pair before relying on this evidence.";
    case "invalidating":
      return "The repositories moved in the wire schema or integration surface. This evidence no longer describes them.";
    default:
      return "The repositories moved in paths this tool does not classify. Review the diff before relying on this evidence.";
  }
}

export function createEvidenceCurrencyReport(input) {
  const worst = ["invalidating", "material", "unclassified", "inert", "current"].find((risk) =>
    input.repositories.some((repository) => repository.risk === risk)
  );
  const report = {
    schemaVersion: "visp.evidence-currency.v1",
    note: "Measures how far committed evidence lags the repositories it describes. A pin that chases HEAD proves nothing; an unmeasured gap hides everything.",
    evidence: input.evidence,
    repositories: [...input.repositories].sort((left, right) => left.name.localeCompare(right.name)),
    summary: {
      current: input.repositories.every((repository) => repository.risk === "current"),
      risk: worst ?? "current",
      // Stated as a sentence because this is the line a human reads first.
      verdict: evidenceCurrencyVerdict(worst)
    }
  };

  report.reportSha256 = sha256Hex(canonicalStringify(report));

  return JSON.parse(canonicalStringify(report));
}

/**
 * The report as a human reads it: the verdict, then one line per repository.
 *
 * Here rather than in the entrypoint because this module already owns how the
 * measurement is stated — it composes `summary.verdict` — and because a CI job
 * that publishes this text needs it to be the same text a developer sees
 * locally. Two renderings of one report is how a run summary and a terminal
 * start disagreeing about what drifted.
 */
export function renderEvidenceCurrency(report) {
  const lines = [report.summary.verdict, ""];

  for (const repository of report.repositories) {
    lines.push(
      `  ${repository.name.padEnd(18)} ${repository.commitsBehind} commits behind, ` +
        `${repository.changedFileCount} files, risk=${repository.risk}`
    );
    for (const critical of repository.criticalPathsTouched) {
      lines.push(
        `      ${critical.prefix} (${critical.files}) — ${critical.reason} [${critical.severity}]`
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

/** GitHub renders `%`, CR and LF in a workflow command message literally unless escaped. */
function escapeAnnotation(text) {
  return `${text}`.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

/**
 * One `::warning::` per repository that has moved.
 *
 * LC-76. The drift has to stay visible on the pull request, and the only two
 * ways CI can say something without failing are an annotation and the run
 * summary. A repository at `current` risk gets none: a standing warning that is
 * always present is read as decoration, which is the same way a standing red
 * check is read.
 *
 * The sentence comes from THIS repository's risk, not from `summary.verdict`.
 * The summary is the worst risk across the pair, so attaching it to each
 * repository told a reader that a repository at `material` had moved the wire
 * schema — naming the wrong repository, on the pull request, in a warning
 * written to be believed.
 */
export function evidenceCurrencyAnnotations(report) {
  return report.repositories
    .filter((repository) => repository.risk !== "current")
    .map((repository) => {
      const paths = repository.criticalPathsTouched.map((entry) => entry.prefix).join(", ");

      return (
        `::warning title=Evidence currency::` +
        escapeAnnotation(
          `${repository.name} is ${repository.commitsBehind} commits past the pin this ` +
            `evidence names (${repository.changedFileCount} files, risk=${repository.risk})` +
            `${paths === "" ? "" : `, touching ${paths}`}. ` +
            evidenceCurrencyVerdict(repository.risk)
        )
      );
    });
}

/**
 * The exit code the run should leave behind.
 *
 * LC-76. `continue-on-error` at the job level changes the workflow RUN's
 * conclusion and not the JOB's, so GitHub still published this job as a check
 * run with `conclusion: failure`, `gh pr checks` still printed `fail`, and every
 * visp-dev pull request carried a red check that was never going to go green. A
 * permanently red check trains people to skim the list, and that is how a real
 * failure gets waved through.
 *
 * Advisory means the VERDICT does not decide the exit code — it does not mean
 * failures are swallowed. A crash still propagates, which is the difference
 * between this and appending `|| true` to the command.
 */
export function evidenceCurrencyExitCode(report, { advisory = false } = {}) {
  if (advisory) return 0;

  return report.summary.risk === "invalidating" ? 1 : 0;
}

export function verifyEvidenceCurrencyReport(report) {
  if (report.schemaVersion !== "visp.evidence-currency.v1") {
    throw new Error("Evidence currency report has an unexpected schema version.");
  }

  const unhashed = structuredClone(report);

  delete unhashed.reportSha256;

  if (report.reportSha256 !== sha256Hex(canonicalStringify(unhashed))) {
    throw new Error("Evidence currency report hash does not match its content.");
  }

  // A report claiming currency while any repository has moved is the failure
  // this verifier exists to catch.
  const moved = report.repositories.filter((repository) => repository.commitsBehind > 0);

  if (report.summary.current === true && moved.length > 0) {
    throw new Error("Evidence currency report claims currency while repositories have moved.");
  }

  return true;
}
