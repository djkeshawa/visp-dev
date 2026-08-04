// P12-US-02 probe: does the compatibility claim the release train made actually hold?
//
// The Phase 10 train published a bridge Hyper (0.6.0) specifically so a user
// mid-upgrade always has a coordinator able to drive EITHER Kit generation, and
// a final Hyper (0.7.0) that took the `visp` name. Those are compatibility
// claims, and no harness has ever tested them — the phase-6 pin describes an
// older generation entirely.
//
// This probe installs real registry pairs into isolated prefixes and asks, for
// each combination, the only question that matters: does the coordinator
// negotiate a protocol with that engine and get a usable answer?
//
// It deliberately reports rather than asserts. A combination that does NOT work
// is a finding about the release, not a failure of the probe.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { runProcess } from "../src/compatibility-lab.mjs";

const COMBINATIONS = [
  {
    id: "new_kit_new_hyper",
    kit: "visp-kit@0.4.0",
    hyper: "visp-hyper-agent@0.7.0",
    kitBin: "visp-kit",
    hyperBin: "visp",
    expectation: "the shipped pair; should negotiate 3.4"
  },
  {
    id: "new_kit_bridge_hyper",
    kit: "visp-kit@0.4.0",
    hyper: "visp-hyper-agent@0.6.0",
    kitBin: "visp-kit",
    hyperBin: "visp-hyper",
    expectation: "the bridge driving the renamed Kit; the upgrade path's second half"
  },
  {
    id: "old_kit_bridge_hyper",
    kit: "visp-kit@0.2.3",
    hyper: "visp-hyper-agent@0.6.0",
    kitBin: "visp",
    hyperBin: "visp-hyper",
    expectation: "the bridge driving the pre-rename Kit; the upgrade path's first half"
  },
  {
    id: "old_kit_new_hyper",
    kit: "visp-kit@0.2.3",
    hyper: "visp-hyper-agent@0.7.0",
    kitBin: "visp",
    hyperBin: "visp",
    expectation:
      "CROSS-GENERATION: final Hyper against pre-rename Kit. Both declare `visp`, so this is also the collision case."
  }
];

async function probe(combination) {
  const root = await mkdtemp(join(tmpdir(), `xgen-${combination.id}-`));
  const kitPrefix = join(root, "kit-prefix");
  const hyperPrefix = join(root, "hyper-prefix");
  const project = join(root, "project");
  const observations = {};

  try {
    // Separate prefixes: this probe is about protocol negotiation, so the two
    // packages must not contend for a name on PATH before we get there. The
    // collision itself is a separate, already-known property.
    const installKit = await runProcess(
      "npm",
      ["install", "-g", combination.kit],
      { timeoutMs: 300_000, env: { ...process.env, npm_config_prefix: kitPrefix } }
    );
    const installHyper = await runProcess(
      "npm",
      ["install", "-g", combination.hyper],
      { timeoutMs: 300_000, env: { ...process.env, npm_config_prefix: hyperPrefix } }
    );
    observations.installed =
      installKit.exitCode === 0 && installHyper.exitCode === 0;
    if (!observations.installed) {
      return { ...combination, worked: false, observations, reason: "install failed" };
    }

    const kitBinPath = join(kitPrefix, "bin", combination.kitBin);
    const hyperBinPath = join(hyperPrefix, "bin", combination.hyperBin);
    const env = {
      ...process.env,
      // Kit first: the coordinator must find the ENGINE, not itself.
      PATH: `${join(kitPrefix, "bin")}${delimiter}${join(hyperPrefix, "bin")}${delimiter}${process.env.PATH}`,
      VISP_KIT_BINARY: kitBinPath
    };
    const run = (bin, args) =>
      runProcess(bin, args, { timeoutMs: 240_000, cwd: project, env });

    await runProcess("git", ["init", project], { timeoutMs: 60_000 });
    await runProcess("git", ["-C", project, "config", "user.email", "p@example.com"], { timeoutMs: 60_000 });
    await runProcess("git", ["-C", project, "config", "user.name", "p"], { timeoutMs: 60_000 });

    const init = await run(kitBinPath, ["init", project]);
    observations.kitInit = init.exitCode;

    // What protocols does this engine advertise?
    const contract = await run(kitBinPath, ["integration", "contract", project, "--json"]);
    try {
      const parsed = JSON.parse(contract.stdout?.text ?? "");
      observations.advertised = parsed.protocols?.workflowAction?.supported ?? null;
      observations.kitCliName = parsed.kit?.cliName ?? null;
    } catch {
      observations.advertised = null;
    }

    // Can the coordinator actually drive it?
    const status = await run(hyperBinPath, ["--project", project, "status"]);
    observations.hyperStatusExit = status.exitCode;
    const statusText = `${status.stdout?.text ?? ""}${status.stderr?.text ?? ""}`;
    observations.hyperSawKit = !/not available|no kit|unavailable/iu.test(statusText);

    const worked =
      init.exitCode === 0 &&
      Array.isArray(observations.advertised) &&
      status.exitCode === 0 &&
      observations.hyperSawKit;

    return { ...combination, worked, observations };
  } catch (error) {
    return {
      ...combination,
      worked: false,
      observations,
      reason: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const results = [];
for (const combination of COMBINATIONS) {
  const result = await probe(combination);
  results.push(result);
  console.log(
    `${result.worked ? "WORKS  " : "BROKEN "} ${result.id.padEnd(22)} ` +
      `kit=${result.kit} hyper=${result.hyper} ` +
      `advertised=${JSON.stringify(result.observations.advertised)} ` +
      `hyperExit=${result.observations.hyperStatusExit ?? "n/a"}` +
      (result.reason ? ` reason=${result.reason}` : "")
  );
}

const out = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : undefined;
if (out !== undefined) {
  await writeFile(
    out,
    `${JSON.stringify(
      {
        probe: "cross-generation-compatibility",
        note: "Reports rather than asserts. A combination that does not work is a finding about the release, not a probe failure.",
        platform: process.platform,
        node: process.version,
        results
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

console.log(`\n${results.filter((r) => r.worked).length}/${results.length} combinations work.`);
