import { readFile } from "node:fs/promises";

import { canonicalStringify, sha256Hex } from "../../src/compatibility-lab.mjs";
import {
  PHASE_6_COMPATIBILITY_DEFINITION,
  createPhase6CompatibilityReport
} from "../../src/phase-6-compatibility.mjs";
import {
  REQUIRED_FIXTURES,
  createConformanceFixtureReport
} from "../../src/conformance-fixtures.mjs";
import { createPlatformProvenanceReport } from "../../src/release-evidence.mjs";

export const PHASE_6_RUN_IDENTITY = {
  provider: "local",
  runAttempt: "1",
  runId: "c1-phase-6-test"
};

export const PLATFORM_RUN_IDENTITY = {
  provider: "github-actions",
  runAttempt: "1",
  runId: "30686678616"
};

const phase6Baseline = JSON.parse(
  await readFile(
    new URL("../../evidence/phase-6-pair-linux-x64-node24.json", import.meta.url),
    "utf8"
  )
);

export const candidate = JSON.parse(
  await readFile(
    new URL("../../evidence/release-candidate-linux-x64-node24.json", import.meta.url),
    "utf8"
  )
);

function packedPackage(identity) {
  return {
    source: { commit: identity.commit, tree: identity.tree },
    pack: {
      first: {
        package: { name: identity.name, version: identity.version },
        sha256: identity.tarballSha256
      }
    }
  };
}

/** Synthetic structural fixture only. Never use it as positive release proof. */
export function syntheticPhase6Report(runIdentity = PHASE_6_RUN_IDENTITY) {
  return createPhase6CompatibilityReport({
    compatibility: phase6Baseline.compatibility,
    environment: phase6Baseline.environment,
    packages: Object.fromEntries(
      Object.entries(PHASE_6_COMPATIBILITY_DEFINITION.packages).map(([id, identity]) => [
        id,
        packedPackage(identity)
      ])
    ),
    runIdentity
  });
}

export function platformReport({
  operatingSystem,
  architecture,
  runIdentity = PLATFORM_RUN_IDENTITY,
  kit = PHASE_6_COMPATIBILITY_DEFINITION.packages.kitFixed,
  hyper = PHASE_6_COMPATIBILITY_DEFINITION.packages.hyperCurrent
}) {
  return createConformanceFixtureReport({
    environment: { architecture, node: "v24.18.0", operatingSystem },
    fixtures: REQUIRED_FIXTURES.map((entry) => ({
      ...entry,
      observed: {},
      status: "pass"
    })),
    packages: {
      kit: packedPackage(kit),
      hyper: packedPackage(hyper)
    },
    runIdentity
  });
}

export function platformProvenance(linux, darwin) {
  return createPlatformProvenanceReport({
    run: {
      conclusion: "success",
      event: "push",
      headSha: "7".repeat(40),
      provider: PLATFORM_RUN_IDENTITY.provider,
      repository: "djkeshawa/visp-dev",
      runAttempt: PLATFORM_RUN_IDENTITY.runAttempt,
      runId: PLATFORM_RUN_IDENTITY.runId,
      url: "https://github.com/djkeshawa/visp-dev/actions/runs/30686678616",
      workflowPath: ".github/workflows/test.yml"
    },
    artifacts: [
      {
        artifactDigestSha256: "1".repeat(64),
        artifactId: "1",
        artifactName: "conformance-fixtures-ubuntu-latest",
        artifactUrl: "https://api.github.com/repos/djkeshawa/visp-dev/actions/artifacts/1",
        archiveMemberPath: "conformance-fixtures-linux-x64-node24.json",
        destinationPath: "evidence/conformance-fixtures-linux-x64-node24.json",
        expectedArchitecture: "x64",
        expectedNodeMajor: 24,
        expectedOperatingSystem: "linux",
        headSha: "7".repeat(40),
        rawFileSha256: sha256Hex(canonicalStringify(linux)),
        reportSha256: linux.reportSha256,
        workflowRunId: PLATFORM_RUN_IDENTITY.runId
      },
      {
        artifactDigestSha256: "2".repeat(64),
        artifactId: "2",
        artifactName: "conformance-fixtures-macos-latest",
        artifactUrl: "https://api.github.com/repos/djkeshawa/visp-dev/actions/artifacts/2",
        archiveMemberPath: "conformance-fixtures-darwin-arm64-node24.json",
        destinationPath: "evidence/conformance-fixtures-darwin-arm64-node24.json",
        expectedArchitecture: "arm64",
        expectedNodeMajor: 24,
        expectedOperatingSystem: "darwin",
        headSha: "7".repeat(40),
        rawFileSha256: sha256Hex(canonicalStringify(darwin)),
        reportSha256: darwin.reportSha256,
        workflowRunId: PLATFORM_RUN_IDENTITY.runId
      }
    ]
  });
}

export function reseal(report) {
  const value = structuredClone(report);

  delete value.reportSha256;
  value.reportSha256 = sha256Hex(canonicalStringify(value));

  return value;
}
