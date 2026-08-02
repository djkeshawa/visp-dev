// P10-US-09 / D-120: the renamed-pair proof.
//
// One pack job builds the exact Kit and Hyper tarballs once; every consumer
// platform runs THIS script against those same files — never re-packing — and
// each case reports honestly. The evidence JSON records the tarball hashes so
// the completion record can bind run identity to artifact identity.
//
// Usage:
//   node scripts/run-renamed-pair-proof.mjs \
//     --kit <visp-kit tarball> --hyper <visp-hyper-agent tarball> \
//     [--expect-kit-sha <hex>] [--expect-hyper-sha <hex>] [--out <evidence.json>]

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

import { runProcess } from "../src/compatibility-lab.mjs";

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined
    ? process.argv[index + 1]
    : fallback;
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

const cases = [];
function record(id, passed, detail) {
  cases.push({ id, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${id}: ${detail}`);
}

async function main() {
  const kitTarball = resolve(arg("kit") ?? "");
  const hyperTarball = resolve(arg("hyper") ?? "");
  if (!arg("kit") || !arg("hyper")) {
    console.error("Both --kit and --hyper tarball paths are required.");
    process.exit(2);
  }

  const kitSha = await sha256File(kitTarball);
  const hyperSha = await sha256File(hyperTarball);

  // The artifact/run-identity handoff (D-120): a consumer that received the
  // wrong bytes must fail before proving anything about them.
  for (const [name, actual, expected] of [
    ["visp-kit", kitSha, arg("expect-kit-sha")],
    ["visp-hyper-agent", hyperSha, arg("expect-hyper-sha")]
  ]) {
    if (expected !== undefined && expected !== actual) {
      console.error(`${name} tarball sha256 ${actual} does not match expected ${expected}.`);
      process.exit(2);
    }
  }

  const root = await mkdtemp(join(tmpdir(), "renamed-pair-proof-"));
  const prefix = join(root, "prefix");
  const project = join(root, "project");
  const env = {
    ...process.env,
    npm_config_prefix: prefix,
    PATH: `${join(prefix, "bin")}${delimiter}${process.env.PATH}`
  };
  const run = (command, args, options = {}) =>
    runProcess(command, args, { timeoutMs: 240_000, ...options, env: options.env ?? env });

  try {
    // Install the exact pair globally into an isolated prefix.
    const installKit = await run("npm", ["install", "-g", kitTarball]);
    const installHyper = await run("npm", ["install", "-g", hyperTarball]);
    record(
      "install-pair",
      installKit.exitCode === 0 && installHyper.exitCode === 0,
      `npm install -g exit codes kit=${installKit.exitCode} hyper=${installHyper.exitCode}`
    );

    // Case 1: identities. The package visp-kit provides visp-kit; the package
    // visp-hyper-agent provides visp (and visp-hyper).
    const kitVersion = await run("visp-kit", ["--version"]);
    const hyperVersion = await run("visp", ["--version"]);
    const hyperAlias = await run("visp-hyper", ["--version"]);
    record(
      "binary-identities",
      kitVersion.exitCode === 0 && hyperVersion.exitCode === 0 && hyperAlias.exitCode === 0,
      `visp-kit=${kitVersion.stdout?.text?.trim()} visp=${hyperVersion.stdout?.text?.trim()} visp-hyper=${hyperAlias.stdout?.text?.trim()}`
    );

    // Case 2: a prepared Kit project negotiates protocol 3.4 through the pair.
    await run("git", ["init", project]);
    await run("git", ["-C", project, "config", "user.email", "proof@example.com"]);
    await run("git", ["-C", project, "config", "user.name", "proof"]);
    const init = await run("visp-kit", ["init", project]);
    const scan = await run("visp-kit", ["scan", project]);
    record(
      "kit-init-scan",
      init.exitCode === 0 && scan.exitCode === 0,
      `init=${init.exitCode} scan=${scan.exitCode}`
    );

    const contract = await run("visp-kit", ["integration", "contract", project, "--json"]);
    let advertises34 = false;
    try {
      const parsed = JSON.parse(contract.stdout?.text ?? "");
      advertises34 = parsed.protocols.workflowAction.supported.includes("3.4");
    } catch {
      advertises34 = false;
    }
    record("contract-advertises-3.4", advertises34, "integration contract lists protocol 3.4");

    // Case 3: Hyper drives Kit through the bridge (binary resolution finds
    // visp-kit; the dispatcher decides nothing).
    const hyperStatus = await run("visp", ["--project", project, "status"]);
    record(
      "hyper-drives-kit",
      hyperStatus.exitCode === 0,
      `visp status exit=${hyperStatus.exitCode}`
    );

    // Case 4: wrong-binary/self-invocation. With visp-kit hidden from PATH
    // (a bin dir holding ONLY the hyper launcher), spawning `visp` must be
    // refused cleanly by the resolver, never parsed as Kit output. Node stays
    // reachable — the launcher is a #!/usr/bin/env node script.
    const hyperOnly = join(root, "hyper-only-bin");
    await mkdir(hyperOnly, { recursive: true });
    await symlink(join(prefix, "bin", "visp"), join(hyperOnly, "visp"));
    const hyperOnlyPath = `${hyperOnly}${delimiter}${dirname(process.execPath)}`;
    const selfInvocation = await run(join(hyperOnly, "visp"), ["--project", project, "new", "a goal"], {
      env: { ...env, PATH: hyperOnlyPath }
    });
    const selfText = `${selfInvocation.stdout?.text ?? ""}${selfInvocation.stderr?.text ?? ""}`;
    record(
      "self-invocation-guard",
      selfInvocation.exitCode !== 0 && /visp-hyper-agent itself|not available/u.test(selfText),
      `exit=${selfInvocation.exitCode}`
    );

    // Case 5: degraded mode — recall without Memory is a visible refusal.
    const recall = await run("visp", ["--project", project, "recall", "anything"], {
      env: { ...env }
    });
    const recallText = `${recall.stdout?.text ?? ""}${recall.stderr?.text ?? ""}`;
    record(
      "recall-refuses-visibly",
      recall.exitCode !== 0 && /needs visp-memory|not configured/u.test(recallText),
      `exit=${recall.exitCode}`
    );

    // Case 6: the zero-command false pass stays closed (D-115 / P10-US-02).
    const check = await run(
      "visp-kit",
      ["verify", project, "--skip-commands", "--no-status-update", "--require-command-evidence", "--json"]
    );
    let zeroCommandClosed = false;
    try {
      const parsed = JSON.parse(check.stdout?.text ?? "");
      zeroCommandClosed = parsed.success === false;
    } catch {
      zeroCommandClosed = check.exitCode !== 0;
    }
    record(
      "zero-command-evidence-closed",
      zeroCommandClosed,
      "verify with zero executed commands does not report success"
    );

    // Case 7: generated assets speak the new vocabulary — the CI workflow this
    // pair generates must never run the removed `visp` command.
    const hooks = await run("visp-kit", ["hooks", "ci", project]);
    let ciClean = false;
    try {
      const workflow = await readFile(
        join(project, ".github", "workflows", "visp-evidence.yml"),
        "utf8"
      );
      ciClean = !/^\s*run: visp (?!-)/mu.test(workflow) && workflow.includes("visp-kit policy validate");
    } catch {
      ciClean = false;
    }
    record(
      "generated-ci-new-vocabulary",
      hooks.exitCode === 0 && ciClean,
      "hooks ci renders visp-kit commands only"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const passed = cases.every((item) => item.passed);
  const evidence = {
    proof: "renamed-pair",
    platform: process.platform,
    node: process.version,
    tarballs: {
      "visp-kit": { path: kitTarball, sha256: kitSha },
      "visp-hyper-agent": { path: hyperTarball, sha256: hyperSha }
    },
    cases,
    passed
  };
  const out = arg("out");
  if (out !== undefined) {
    await writeFile(out, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }
  console.log(passed ? "RENAMED PAIR PROOF: PASSED" : "RENAMED PAIR PROOF: FAILED");
  process.exit(passed ? 0 : 1);
}

await main();
