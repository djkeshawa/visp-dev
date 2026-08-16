/**
 * Reading each host's packed templates and recording what they render to.
 *
 * The digest is taken of the RENDERED text, not the template, because that is
 * what lands in a user's project. The runtime check later re-reads the installed
 * file and compares against this same digest, so "the template says X" and "the
 * host received X" are two separate observations rather than one assumption.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { sha256Hex } from "../../platform/canonical-json.mjs";
import { HOSTS, REQUIRED_DESTINATIONS, validateManifest } from "./manifest.mjs";

/** Model names a host pins for each role; absent means the placeholder survives. */
async function readModelMap(hostRoot) {
  try {
    const parsed = JSON.parse(await readFile(path.join(hostRoot, "model-map.json"), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function renderModels(content, models) {
  return content
    .replaceAll("{{COORDINATOR_MODEL}}", models.coordinator ?? "{{COORDINATOR_MODEL}}")
    .replaceAll("{{SCOUT_MODEL}}", models.scout ?? "{{SCOUT_MODEL}}")
    .replaceAll("{{IMPLEMENTER_MODEL}}", models.implementer ?? "{{IMPLEMENTER_MODEL}}");
}

/** One host's example: its manifest digest, its declared support, and its rendered assets. */
async function readHostExample(templatesRoot, host) {
  const hostRoot = path.join(templatesRoot, host);
  const manifestText = await readFile(path.join(hostRoot, "capabilities.json"), "utf8");
  const manifest = JSON.parse(manifestText);
  validateManifest(manifest, host);
  const models = await readModelMap(hostRoot);

  const assets = [];
  for (const asset of manifest.assets) {
    const source = await readFile(path.join(hostRoot, asset.templatePath), "utf8");
    const rendered = renderModels(source, models);
    assets.push({
      destination: asset.destination,
      renderedSha256: sha256Hex(rendered),
      templatePath: asset.templatePath,
    });
    // Copilot only applies an instructions file that declares its scope. Without
    // the frontmatter the file installs successfully and is never read.
    if (host === "copilot" && !rendered.startsWith('---\napplyTo: "**"\n---\n')) {
      throw new Error("Copilot instructions lack required applyTo frontmatter");
    }
  }

  const destinations = new Set(assets.map((asset) => asset.destination));
  for (const required of REQUIRED_DESTINATIONS[host]) {
    if (!destinations.has(required)) {
      throw new Error(`${host} packed example lacks native destination ${required}`);
    }
  }

  return {
    assets,
    fallbacks: manifest.fallbacks,
    host,
    manifestSha256: sha256Hex(manifestText),
    surface: manifest.validatedAgainst.surface,
    supports: manifest.supports,
    validatedAsOf: manifest.validatedAgainst.asOf,
  };
}

export async function collectHostExamples(templatesRoot) {
  const examples = [];
  for (const host of HOSTS) examples.push(await readHostExample(templatesRoot, host));
  return examples;
}
