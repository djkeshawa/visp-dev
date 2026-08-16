/**
 * The human-readable renderings. `--json` bypasses every function here, so
 * nothing in this file may compute a fact the JSON does not already carry.
 */

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
