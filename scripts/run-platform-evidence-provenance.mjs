#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { canonicalStringify, sha256Hex } from "../src/compatibility-lab.mjs";
import { verifyConformanceFixtureReport } from "../src/conformance-fixtures.mjs";
import {
  createPlatformProvenanceReport,
  verifyReviewedPlatformProvenanceReport
} from "../src/release-evidence.mjs";

const DESTINATIONS = {
  linux: "evidence/conformance-fixtures-linux-x64-node24.json",
  macos: "evidence/conformance-fixtures-darwin-arm64-node24.json"
};

function parseArguments(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];

    if (!flag?.startsWith("--") || argv[index + 1] === undefined) {
      throw new TypeError(`${flag ?? "argument"} requires a value`);
    }
    options[flag.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] =
      argv[index + 1];
  }

  return options;
}

async function artifact(options, platform) {
  const destinationPath = DESTINATIONS[platform];
  const archiveMemberPath = path.basename(destinationPath);
  const artifactRoot = options[`${platform}ArtifactRoot`];
  if (typeof artifactRoot !== "string" || artifactRoot.length === 0) {
    throw new TypeError(`--${platform}-artifact-root is required`);
  }
  const member = await readFile(path.join(artifactRoot, archiveMemberPath));
  const destination = await readFile(destinationPath);
  if (!member.equals(destination)) {
    throw new Error(`${platform} exact artifact member differs from ${destinationPath}`);
  }
  const report = JSON.parse(member.toString("utf8"));

  verifyConformanceFixtureReport(report);

  return {
    artifactDigestSha256: options[`${platform}ArtifactDigest`],
    artifactId: options[`${platform}ArtifactId`],
    artifactName: options[`${platform}ArtifactName`],
    artifactUrl:
      `https://api.github.com/repos/djkeshawa/visp-dev/actions/artifacts/` +
      options[`${platform}ArtifactId`],
    archiveMemberPath,
    destinationPath,
    expectedArchitecture: platform === "linux" ? "x64" : "arm64",
    expectedNodeMajor: 24,
    expectedOperatingSystem: platform === "linux" ? "linux" : "darwin",
    headSha: options.headSha,
    rawFileSha256: sha256Hex(member),
    reportSha256: report.reportSha256,
    workflowRunId: options.runId
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));

  if (options.verify !== undefined) {
    const report = JSON.parse(await readFile(options.verify, "utf8"));

    verifyReviewedPlatformProvenanceReport(report);
    process.stdout.write(
      `PASS platform provenance verified: run ${report.run.runId}, ${report.artifacts.length} exact members\n`
    );
    return;
  }

  const report = createPlatformProvenanceReport({
    run: {
      conclusion: options.conclusion,
      event: options.event,
      headSha: options.headSha,
      provider: "github-actions",
      repository: "djkeshawa/visp-dev",
      runAttempt: options.runAttempt,
      runId: options.runId,
      url: `https://github.com/djkeshawa/visp-dev/actions/runs/${options.runId}`,
      workflowPath: ".github/workflows/test.yml"
    },
    artifacts: await Promise.all([
      artifact(options, "linux"),
      artifact(options, "macos")
    ])
  });

  if (options.output !== undefined) {
    await writeFile(options.output, canonicalStringify(report));
    process.stdout.write(`Wrote ${options.output}\n`);
  } else {
    process.stdout.write(canonicalStringify(report));
  }
}

main().catch((error) => {
  process.stderr.write(`platform-provenance: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
