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
import { canonicalStringify, runProcess, sha256Hex } from "./compatibility-lab.mjs";

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
  { prefix: "src/validators/", reason: "artifact validation", severity: "material" }
];

/** Paths that cannot change observable behaviour for an integrator. */
const INERT_PREFIXES = ["tests/", "docs/", ".github/", "planning/"];
const INERT_FILES = ["README.md", "AGENTS.md", "NOTICE", "LICENSE", "SECURITY.md", "TRADEMARKS.md", "CODE_OF_CONDUCT.md"];

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
      // The whole point of the classification: a reader can see *why* the
      // evidence might no longer hold, not just that something moved.
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
      verdict:
        worst === "current"
          ? "The evidence describes the checked-out repositories exactly."
          : worst === "inert"
            ? "The repositories moved, but only in paths that cannot change integrator-observable behaviour."
            : worst === "material"
              ? "The repositories moved in paths that can change behaviour. Re-run the pair before relying on this evidence."
              : worst === "invalidating"
                ? "The repositories moved in the wire schema or integration surface. This evidence no longer describes them."
                : "The repositories moved in paths this tool does not classify. Review the diff before relying on this evidence."
    }
  };

  report.reportSha256 = sha256Hex(canonicalStringify(report));

  return JSON.parse(canonicalStringify(report));
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
