/**
 * LC-76 — the advisory currency entrypoint, run as CI runs it.
 *
 * The unit tests pin what the exit code SHOULD be for a given verdict. This
 * pins that the flag reaches `process.exitCode` at all, which is the part that
 * was broken: the measurement was always right and the job was red anyway.
 *
 * SIBLING-OPTIONAL, unlike the seam tests. Those fail rather than skip because
 * a seam that cannot compare has silently stopped checking the thing it names.
 * This is a command lifecycle, not a comparison, and the preflight banner
 * promises a lone clone that the seam tests "will fail for this reason and no
 * other" — a second file failing there would make that sentence false, in the
 * one message in the run written to be believed.
 *
 * So an absent sibling SKIPS, visibly. A sibling that is present but too
 * shallow to reach the frozen pins — which is every leg of the `test` matrix —
 * does not: it asserts the half of the contract that still holds, that a
 * measurement which could not be made is still a failure.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { PUBLISHED_ARTIFACT_DIFFERENTIAL_DEFINITION }
  from "../../../src/compatibility/suites/published-artifact-differential/index.mjs";
import { locateProduct } from "../../../scripts/maintenance/workspace-layout.mjs";

const execFileAsync = promisify(execFile);
const devRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const SIBLINGS = ["visp-kit", "visp-hyper-agent"];

function productRoot(name) {
  return locateProduct(name, devRoot);
}

/** True when both engine checkouts are present, having said so if they are not. */
function siblingsPresent(t) {
  const absent = SIBLINGS.filter((name) => productRoot(name) === null);

  if (absent.length === 0) return true;
  t.skip(
    `the currency entrypoint measures a real checkout, and ${absent.join(" and ")} ` +
      'is not in this workspace. See "Workspace layout the suite requires" in README.md.'
  );
  return false;
}

/**
 * Whether the frozen pins are reachable in the siblings this checkout has.
 *
 * The `test` matrix job vendors the siblings at `fetch-depth: 1` on purpose —
 * "the seams read files, never history" — so the pins, which are months of
 * commits back, are simply not in those clones and no measurement can be made.
 * Only the `evidence-currency` job fetches full depth.
 *
 * This is NOT a skip. Both branches below assert a real half of the `--advisory`
 * contract: with the pins reachable, that the verdict stops deciding the exit
 * code; without them, that a measurement which could not be made is still a
 * failure. The one thing neither branch does is pass by proving nothing.
 */
async function pinsAreReachable() {
  const pins = [
    ["visp-kit", PUBLISHED_ARTIFACT_DIFFERENTIAL_DEFINITION.packages.kitFixed.commit],
    ["visp-hyper-agent", PUBLISHED_ARTIFACT_DIFFERENTIAL_DEFINITION.packages.hyperCurrent.commit]
  ];

  for (const [name, commit] of pins) {
    const probe = await execFileAsync("git", ["-C", productRoot(name), "cat-file", "-e", `${commit}^{commit}`])
      .then(() => true)
      .catch(() => false);

    if (!probe) return false;
  }
  return true;
}

/**
 * The half of the contract a shallow checkout can still prove, asserted rather
 * than skipped.
 *
 * `--advisory` neutralises the VERDICT, not the process. A pin that is not in
 * the clone means no measurement happened, and reporting success over that is
 * the failure this ticket is about — a green check standing in for a fact
 * nobody established. So the shallow legs assert exactly that, loudly.
 */
async function assertUnmeasurableIsAFailure(t) {
  t.diagnostic("frozen pins are outside these sibling clones; asserting the failure invariant");

  const advisory = await runCurrency(["--advisory"]);

  assert.notEqual(
    advisory.exitCode,
    0,
    `--advisory reported success over a measurement it could not make:\n${advisory.stdout}`
  );
  assert.notEqual(advisory.stderr, "", "the reason has to reach the log");
}

/** The script as the workflow invokes it, plus whatever this case is testing. */
async function runCurrency(extraArguments) {
  const result = await execFileAsync(
    process.execPath,
    [
      path.join(devRoot, "scripts", "compatibility", "currency.mjs"),
      "--kit-repository",
      productRoot("visp-kit"),
      "--hyper-repository",
      productRoot("visp-hyper-agent"),
      ...extraArguments
    ],
    { cwd: devRoot, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }
  ).catch((error) => error);

  return {
    exitCode: result.code ?? 0,
    stdout: `${result.stdout ?? ""}`,
    stderr: `${result.stderr ?? ""}`
  };
}

test("--advisory changes the exit code and nothing else about the measurement", async (t) => {
  if (!siblingsPresent(t)) return;
  if (!(await pinsAreReachable())) return assertUnmeasurableIsAFailure(t);

  const [advisory, judged, json] = await Promise.all([
    runCurrency(["--advisory"]),
    runCurrency([]),
    runCurrency(["--json"])
  ]);
  const report = JSON.parse(json.stdout);
  // The annotations are appended after the report and are the only difference.
  const withoutAnnotations = advisory.stdout.replace(/^::.*$\n?/gmu, "");

  // Derived from the same run rather than hardcoded: the real repositories drift
  // as they are worked on, so pinning a risk here would pin the calendar. What
  // must hold is the RELATIONSHIP between the verdict and the two exit codes.
  assert.equal(advisory.exitCode, 0, `--advisory exited ${advisory.exitCode}:\n${advisory.stdout}`);
  assert.equal(judged.exitCode, report.summary.risk === "invalidating" ? 1 : 0);
  assert.equal(withoutAnnotations, judged.stdout, "advisory must not abbreviate the report");

  for (const repository of report.repositories) {
    assert.match(
      advisory.stdout,
      new RegExp(`${repository.name}\\s+${repository.commitsBehind} commits behind`, "u"),
      `${repository.name} is missing from the advisory output`
    );
    assert.ok(advisory.stdout.includes(`risk=${repository.risk}`));
  }
});

test("a repository that has moved is annotated for the pull request", async (t) => {
  if (!siblingsPresent(t)) return;
  if (!(await pinsAreReachable())) return assertUnmeasurableIsAFailure(t);

  const [advisory, judged, json] = await Promise.all([
    runCurrency(["--advisory"]),
    runCurrency([]),
    runCurrency(["--json"])
  ]);
  const report = JSON.parse(json.stdout);
  const annotations = advisory.stdout.split("\n").filter((line) => line.startsWith("::"));
  const moved = report.repositories.filter((repository) => repository.risk !== "current");

  assert.equal(annotations.length, moved.length, "one annotation per repository that moved");
  for (const annotation of annotations) {
    assert.match(annotation, /^::warning title=Evidence currency::/u);
  }
  // Without the flag nothing is annotated: a run that can fail on the verdict
  // already has a way to be seen, and a warning next to a failure is noise.
  assert.equal(judged.stdout.includes("::warning"), false);
});

test("--json stays parseable when advisory annotations are also asked for", async (t) => {
  if (!siblingsPresent(t)) return;
  if (!(await pinsAreReachable())) return assertUnmeasurableIsAFailure(t);

  const machine = await runCurrency(["--json", "--advisory"]);

  // A workflow command is not data. Appending one to the document breaks the
  // only consumer that asked for a document.
  assert.doesNotThrow(() => JSON.parse(machine.stdout));
  assert.equal(machine.stdout.includes("::warning"), false);
});

test("an unreadable repository still fails, flag or no flag", async () => {
  // No sibling needed: the point is a path that is deliberately not a
  // repository, so this one case holds in a lone clone too.
  // The line between "the verdict does not gate" and "nothing gates". If
  // --advisory swallowed this the job would be green over a measurement that
  // never happened, which is worse than the red check it replaced.
  const broken = await execFileAsync(
    process.execPath,
    [
      path.join(devRoot, "scripts", "compatibility", "currency.mjs"),
      "--kit-repository",
      path.join(devRoot, "no-such-repository"),
      "--hyper-repository",
      path.join(devRoot, "no-such-repository"),
      "--advisory"
    ],
    { cwd: devRoot, encoding: "utf8" }
  ).catch((error) => error);

  assert.notEqual(broken.code, 0, "--advisory must not turn a failed measurement into a pass");
});
