/**
 * The capability manifest each host ships, and what makes one valid.
 *
 * A host manifest is a CLAIM about an integration surface somebody checked on a
 * date, so `validatedAgainst` is mandatory and closed: an undated claim about a
 * moving product is not evidence. The key sets are exact rather than minimum
 * because an unknown field is a manifest written against a schema this code
 * does not implement, and accepting it would silently ignore the part that
 * mattered.
 */
import path from "node:path";

/** Every host with a packed integration example, in report order. */
export const HOSTS = ["claude-code", "codex", "copilot", "generic", "opencode"];

/** How completely a host supports one capability. */
const SUPPORT = new Set(["native", "surface_limited", "manual", "unsupported"]);

const MECHANICAL_FALLBACKS = new Set(["native_hooks", "git_and_ci"]);
export const ORCHESTRATION_FALLBACKS = new Set(["native_subagents", "sequential"]);
export const MODEL_FALLBACKS = new Set(["automatic", "host_controlled", "advisory"]);

export const SUPPORT_KEYS = [
  "repoGuidance",
  "skills",
  "commands",
  "hooks",
  "mcp",
  "subagents",
  "verifierRole",
  "challengerRole",
  "automaticModelSelection",
];

/**
 * The native location each host actually reads. A packed example that lands
 * nowhere the host looks is a file, not an integration.
 */
export const REQUIRED_DESTINATIONS = {
  "claude-code": [
    ".claude/agents/coordinator.md",
    ".claude/skills/visp-hyper/SKILL.md",
  ],
  codex: [".agents/skills/visp-hyper/SKILL.md"],
  copilot: [".github/instructions/visp-hyper.instructions.md"],
  generic: ["visp-hyper-instructions.md"],
  opencode: [".agents/skills/visp-hyper/SKILL.md"],
};

/** The command each host installs, used to prove the fallback path is isolated. */
export const HOST_EXECUTABLES = {
  "claude-code": "claude",
  codex: "codex",
  copilot: "copilot",
  opencode: "opencode",
};

const TOP_LEVEL_MANIFEST_KEYS = new Set([
  "manifestVersion",
  "host",
  "validatedAgainst",
  "supports",
  "fallbacks",
  "assets",
]);
const VALIDATED_AGAINST_KEYS = new Set(["asOf", "hostVersion", "surface", "documentation"]);
const FALLBACK_KEYS = new Set(["mechanicalEnforcement", "orchestration", "modelSelection"]);
const ASSET_KEYS = new Set(["templatePath", "destination"]);

export function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/** A project-relative POSIX path that cannot escape the project. */
export function safeRelative(value) {
  return typeof value === "string"
    && value.length > 0
    && !path.isAbsolute(value)
    && !value.includes("\\")
    && value.split("/").every((part) => part && part !== "." && part !== "..");
}

export function isHttpUrl(value) {
  if (!nonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
    throw new Error(`${label} contains missing or unknown fields`);
  }
}

export function isSupportLevel(value) {
  return SUPPORT.has(value);
}

export function validateManifest(manifest, host) {
  assertExactKeys(manifest, TOP_LEVEL_MANIFEST_KEYS, `${host} capability manifest`);
  assertExactKeys(manifest.validatedAgainst, VALIDATED_AGAINST_KEYS, `${host} validatedAgainst`);
  assertExactKeys(manifest.supports, new Set(SUPPORT_KEYS), `${host} supports`);
  assertExactKeys(manifest.fallbacks, FALLBACK_KEYS, `${host} fallbacks`);
  if (manifest.manifestVersion !== "1.0"
    || manifest.host !== host
    || !HOSTS.includes(manifest.host)
    || !/^\d{4}-\d{2}-\d{2}$/u.test(manifest.validatedAgainst.asOf ?? "")
    || !(manifest.validatedAgainst.hostVersion === null
      || nonEmptyString(manifest.validatedAgainst.hostVersion))
    || !nonEmptyString(manifest.validatedAgainst.surface)
    || !Array.isArray(manifest.validatedAgainst.documentation)
    || manifest.validatedAgainst.documentation.length === 0
    || manifest.validatedAgainst.documentation.some((url) => !isHttpUrl(url))
    || !Array.isArray(manifest.assets)
    || manifest.assets.length === 0
    || !MECHANICAL_FALLBACKS.has(manifest.fallbacks.mechanicalEnforcement)
    || !ORCHESTRATION_FALLBACKS.has(manifest.fallbacks.orchestration)
    || !MODEL_FALLBACKS.has(manifest.fallbacks.modelSelection)
    || SUPPORT_KEYS.some((key) => !SUPPORT.has(manifest.supports[key]))) {
    throw new Error(`${host} capability manifest is invalid`);
  }
  const destinations = new Set();
  for (const asset of manifest.assets) {
    assertExactKeys(asset, ASSET_KEYS, `${host} asset`);
    if (!safeRelative(asset.templatePath)
      || !safeRelative(asset.destination)
      || destinations.has(asset.destination)) {
      throw new Error(`${host} capability manifest contains an unsafe or duplicate asset`);
    }
    destinations.add(asset.destination);
  }
  return true;
}
