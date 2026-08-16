/**
 * The host-asset report: what five hosts declare, what their templates render
 * to, and — when a runtime section is present — what the installed package
 * actually did in each of them.
 *
 * Two levels of claim live in one document on purpose. The static level is
 * cheap and always available; the runtime level requires a real install and is
 * absent rather than faked when it did not run. `requireRuntime` is how a caller
 * says which one it needs, so a static-only report can never be mistaken for
 * proof that the assets work.
 */
import { canonicalStringify, sha256Hex } from "../../platform/canonical-json.mjs";
import {
  HOSTS,
  MODEL_FALLBACKS,
  ORCHESTRATION_FALLBACKS,
  REQUIRED_DESTINATIONS,
  SUPPORT_KEYS,
  isSupportLevel,
  nonEmptyString,
  safeRelative,
} from "./manifest.mjs";
import { collectHostExamples } from "./rendering.mjs";

export const HOST_ASSETS_SCHEMA_VERSION = "visp.host-asset-rendering.v2";

const HASH = /^[a-f0-9]{64}$/u;

/** Re-hashes a report over everything except its own digest. */
export function finalizeReport(report) {
  const unhashed = structuredClone(report);
  delete unhashed.reportSha256;
  return JSON.parse(canonicalStringify({
    ...unhashed,
    reportSha256: sha256Hex(canonicalStringify(unhashed)),
  }));
}

export async function createHostAssetsReport({ packageSha256, templatesRoot }) {
  if (!HASH.test(packageSha256)) {
    throw new TypeError("packageSha256 must be a SHA-256 hex digest");
  }
  const examples = await collectHostExamples(templatesRoot);
  return finalizeReport({
    examples,
    package: null,
    packageSha256,
    runtime: null,
    schemaVersion: HOST_ASSETS_SCHEMA_VERSION,
    summary: {
      assetsVerified: examples.reduce((count, example) => count + example.assets.length, 0),
      hostsVerified: examples.length,
      mechanicalFallback: "git_and_ci",
      runtimeHostsVerified: 0,
      runtimeVerified: false,
    },
  });
}

function verifyExample(example, host) {
  if (example?.host !== host
    || !HASH.test(example.manifestSha256 ?? "")
    || !nonEmptyString(example.surface)
    || !/^\d{4}-\d{2}-\d{2}$/u.test(example.validatedAsOf ?? "")
    || !Array.isArray(example.assets)
    || example.assets.length === 0
    || example.fallbacks?.mechanicalEnforcement !== "git_and_ci"
    || !ORCHESTRATION_FALLBACKS.has(example.fallbacks?.orchestration)
    || !MODEL_FALLBACKS.has(example.fallbacks?.modelSelection)
    || Object.keys(example.supports ?? {}).sort().join(",") !== [...SUPPORT_KEYS].sort().join(",")
    || Object.values(example.supports ?? {}).some((value) => !isSupportLevel(value))) {
    throw new Error(`${host} host example is invalid`);
  }
  const destinations = new Set();
  for (const asset of example.assets) {
    if (!safeRelative(asset.destination)
      || !safeRelative(asset.templatePath)
      || !HASH.test(asset.renderedSha256 ?? "")
      || destinations.has(asset.destination)) {
      throw new Error(`${host} host example has invalid assets`);
    }
    destinations.add(asset.destination);
  }
  for (const required of REQUIRED_DESTINATIONS[host]) {
    if (!destinations.has(required)) throw new Error(`${host} native asset is missing`);
  }
}

/**
 * The runtime section, which only a real install can produce.
 *
 * `hostBinary: "intentionally_absent"` is the point of the exercise: the four
 * real hosts are kept off PATH so what is measured is the FALLBACK path, which
 * is the path a user without that host actually gets.
 */
function verifyRuntime(report) {
  if (report.package?.name !== "visp-hyper-agent"
    || !nonEmptyString(report.package.version)
    || !HASH.test(report.package.binSha256 ?? "")
    || !HASH.test(report.package.dependencyTreeSha256 ?? "")
    || !["caller_snapshot", "repository_local_tarballs"].includes(report.package.installCacheMode)
    || report.package.offlineInstall !== true
    || report.package.lifecycleScriptsDisabled !== true
    || !Array.isArray(report.runtime?.hosts)
    || report.runtime.hosts.length !== HOSTS.length
    || report.summary?.runtimeVerified !== true
    || report.summary?.runtimeHostsVerified !== HOSTS.length) {
    throw new Error("Host asset installed runtime summary is invalid");
  }
  for (const [index, host] of HOSTS.entries()) {
    const runtime = report.runtime.hosts[index];
    if (runtime?.configuredHost !== host
      || runtime.assets !== "pass"
      || runtime.doctor !== "pass"
      || runtime.gitFallback !== "installed"
      || runtime.ciFallback !== "installed"
      || runtime.mcp !== "pass"
      || runtime.skillMode !== "review"
      || runtime.kitMode !== "local_checked"
      || runtime.hostBinary !== (host === "generic" ? "not_required" : "intentionally_absent")
      || runtime.hostSelection !== (host === "generic" ? "manual" : "fallback")) {
      throw new Error(`${host} installed runtime is invalid`);
    }
  }
}

export function verifyHostAssetsReport(report, { requireRuntime = false } = {}) {
  if (report?.schemaVersion !== HOST_ASSETS_SCHEMA_VERSION
    || !HASH.test(report.packageSha256 ?? "")
    || !HASH.test(report.reportSha256 ?? "")
    || !Array.isArray(report.examples)
    || report.examples.length !== HOSTS.length) {
    throw new Error("Host asset report identity is invalid");
  }
  const unhashed = structuredClone(report);
  delete unhashed.reportSha256;
  if (sha256Hex(canonicalStringify(unhashed)) !== report.reportSha256) {
    throw new Error("Host asset report hash does not match its content");
  }
  for (const [index, host] of HOSTS.entries()) verifyExample(report.examples[index], host);

  const generic = report.examples.find((entry) => entry.host === "generic");
  if (generic?.fallbacks?.orchestration !== "sequential"
    || generic?.fallbacks?.modelSelection !== "advisory"
    || report.summary?.hostsVerified !== HOSTS.length
    || report.summary?.assetsVerified !== report.examples.reduce(
      (count, example) => count + example.assets.length,
      0,
    )
    || report.summary?.mechanicalFallback !== "git_and_ci") {
    throw new Error("Host asset fallback summary is invalid");
  }

  if (report.runtime === null) {
    if (requireRuntime
      || report.package !== null
      || report.summary?.runtimeVerified !== false
      || report.summary?.runtimeHostsVerified !== 0) {
      throw new Error("Host asset runtime verification is required or inconsistent");
    }
    return true;
  }
  verifyRuntime(report);
  return true;
}
