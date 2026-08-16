/**
 * Turning the closed runtime-lock template into a lock for one packed package.
 *
 * The template is a sentinel document: every field a real lock would carry is
 * present with a `__VISP_LOCAL_*` placeholder, and the whole shape is checked
 * before anything is substituted. A template that had drifted would otherwise
 * produce a lock describing a graph nobody authored.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { canonicalStringify, sha256Hex } from "../platform/canonical-json.mjs";

const DEFAULT_RUNTIME_LOCK_TEMPLATE = fileURLToPath(
  new URL("../../fixtures/runtime-lock-template.json", import.meta.url),
);

export async function materializeRuntimeInstallLock({
  outputPath,
  package: packageIdentity,
  tarballPath,
  templatePath = DEFAULT_RUNTIME_LOCK_TEMPLATE,
}) {
  const templateBytes = await readFile(templatePath);
  const template = JSON.parse(templateBytes.toString("utf8"));
  const localKey = "node_modules/__VISP_LOCAL_NAME__";
  const local = template.packages?.[localKey];
  const root = template.packages?.[""];
  if (template.name !== "visp-compatibility-install"
    || template.lockfileVersion !== 3
    || template.requires !== true
    || canonicalStringify(root?.dependencies) !== canonicalStringify({
      __VISP_LOCAL_NAME__: "file:__VISP_LOCAL_TARBALL__",
    })
    || local?.version !== "__VISP_LOCAL_VERSION__"
    || local?.resolved !== "file:__VISP_LOCAL_TARBALL__"
    || local?.integrity !== "__VISP_LOCAL_INTEGRITY__"
    || canonicalStringify(local?.dependencies) !== canonicalStringify({
      commander: "^12.1.0",
      zod: "^3.25.76",
    })
    || canonicalStringify(local?.bin) !== canonicalStringify({
      __VISP_LOCAL_BIN_NAME__: "__VISP_LOCAL_BIN_PATH__",
    })) {
    throw new Error("Runtime lock template does not match its closed sentinel contract");
  }
  // A package may legitimately declare more than one command: visp-hyper-agent
  // 0.7.0 ships `visp` plus the `visp-hyper` alias it kept for continuity.
  // Requiring exactly one was an assumption from the single-binary era, and it
  // rejected a real published package rather than describing it.
  if (!packageIdentity
    || typeof packageIdentity.name !== "string"
    || typeof packageIdentity.version !== "string"
    || !Array.isArray(packageIdentity.declaredBins)
    || packageIdentity.declaredBins.length === 0) {
    throw new Error("Packed package identity cannot materialize the runtime lock");
  }
  for (const declared of packageIdentity.declaredBins) {
    if (typeof declared?.name !== "string" || typeof declared?.path !== "string") {
      throw new Error("Packed package bin identity cannot materialize the runtime lock");
    }
  }
  const tarballBytes = await readFile(tarballPath);
  const localIntegrity = `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`;
  delete template.packages[localKey];
  root.dependencies = {
    [packageIdentity.name]: "file:__VISP_LOCAL_TARBALL__",
  };
  template.packages[`node_modules/${packageIdentity.name}`] = {
    bin: Object.fromEntries(
      [...packageIdentity.declaredBins]
        .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
        .map((declared) => [declared.name, declared.path])
    ),
    dependencies: structuredClone(local.dependencies),
    integrity: localIntegrity,
    resolved: "file:__VISP_LOCAL_TARBALL__",
    version: packageIdentity.version,
  };
  const materialized = canonicalStringify(template);
  await writeFile(outputPath, materialized, { flag: "wx", mode: 0o600 });
  return {
    localIntegrity,
    materializedSha256: sha256Hex(materialized),
    templateSha256: sha256Hex(templateBytes),
  };
}
