#!/usr/bin/env node
/**
 * Generates a CycloneDX SBOM for each publishable package.
 *
 * `npm sbom` cannot be run in these repositories directly. They use pnpm, whose
 * `node_modules` layout npm cannot interpret, so npm reports every transitive
 * devDependency as missing or invalid and exits with ESBOMPROBLEMS. That is a
 * tooling mismatch, not a broken dependency tree.
 *
 * The fix is also the more correct artifact. An SBOM should describe **what
 * ships**, not the build toolchain that produced it. So this packs the package
 * exactly as `npm publish` would, installs that tarball into an empty directory
 * with npm, and inventories the result. What comes out is the dependency set a
 * user actually receives — for these packages, a handful of runtime
 * dependencies rather than several hundred build-time ones.
 *
 * The SBOM is deliberately **not** shipped inside the package. It records a
 * hash of the tarball, so a copy living inside that tarball would change the
 * hash it is trying to state, and the file could never settle — `--check`
 * failed on every run until it was taken back out. An SBOM describing an
 * artifact cannot be part of that artifact. It is committed beside the source
 * and published as a release asset instead.
 *
 * `--check` is a release-time check, not a CI one. The SBOM embeds a hash of
 * the packed tarball, and `npm pack` is not byte-deterministic across machines
 * — different npm versions and file timestamps change it. CI reported the
 * committed file as stale on every platform, including the one that generated
 * it. Run this before publishing, where the artifact being described is the
 * artifact actually going out.
 */
import { mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { runProcess } from "../src/compatibility-lab.mjs";

const PACKAGES = ["visp-kit", "visp-hyper-agent"];

async function run(command, args, cwd) {
  const result = await runProcess(command, args, { cwd, timeoutMs: 300_000 });

  if (result.exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed in ${cwd}\n${result.stderr?.text ?? ""}`
    );
  }

  return `${result.stdout?.text ?? ""}`;
}

/**
 * Strips the build machine's temporary directory out of `file:` references.
 *
 * npm records where it installed the tarball from, which is a path that exists
 * only on the machine that ran this and differs on every run. Left in, it makes
 * two SBOMs of identical content compare as different, and leaks a local
 * filesystem layout into a published artifact. The filename is the part that
 * carries meaning.
 */
function normalizeLocalUrls(value) {
  if (Array.isArray(value)) return value.map(normalizeLocalUrls);

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, normalizeLocalUrls(nested)])
    );
  }

  if (typeof value === "string" && value.startsWith("file:")) {
    return `file:${path.basename(value.slice("file:".length))}`;
  }

  return value;
}

async function sbomFor(repositoryRoot, name) {
  const staging = await mkdtemp(path.join(tmpdir(), `visp-sbom-${name}-`));

  try {
    await run("npm", ["pack", "--pack-destination", staging], repositoryRoot);

    const packed = (await readdir(staging)).find((entry) => entry.endsWith(".tgz"));

    if (packed === undefined) throw new Error(`npm pack produced no tarball for ${name}`);

    // An empty private manifest, so the only thing in the tree is the package
    // under test and whatever it genuinely requires at runtime.
    await writeFile(
      path.join(staging, "package.json"),
      `${JSON.stringify({ name: "sbom-host", version: "1.0.0", private: true }, null, 2)}\n`
    );
    await run("npm", ["install", `./${packed}`, "--no-audit", "--no-fund"], staging);

    const sbom = JSON.parse(await run("npm", ["sbom", "--sbom-format", "cyclonedx"], staging));

    // The serial number is a fresh UUID on every run, so leaving it in would
    // make two SBOMs of identical content compare as different. Anything that
    // should be reproducible cannot carry a random field.
    delete sbom.serialNumber;

    if (sbom.metadata !== undefined) {
      delete sbom.metadata.timestamp;
      // The host wrapper is scaffolding, not part of what ships.
      delete sbom.metadata.component;
    }

    return normalizeLocalUrls(sbom);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function main() {
  const check = process.argv.includes("--check");
  // Where the package repositories live relative to here. Siblings on a
  // workstation; a checkout directory in CI.
  const rootIndex = process.argv.indexOf("--packages-root");
  const packagesRoot = rootIndex === -1 ? ".." : process.argv[rootIndex + 1];

  for (const name of PACKAGES) {
    const repositoryRoot = path.resolve(process.cwd(), packagesRoot, name);
    const version = JSON.parse(
      await readFile(path.join(repositoryRoot, "package.json"), "utf8")
    ).version;
    const sbom = await sbomFor(repositoryRoot, name);
    const target = path.join(repositoryRoot, "sbom.json");
    const serialized = `${JSON.stringify(sbom, null, 2)}\n`;
    const components = (sbom.components ?? []).length;

    if (check) {
      const existing = await readFile(target, "utf8").catch(() => null);

      if (existing !== serialized) {
        process.stderr.write(
          `FAIL ${name}: sbom.json is stale or missing. Run: npm run sbom\n`
        );
        process.exitCode = 1;
        continue;
      }

      process.stdout.write(`PASS ${name}@${version}: sbom.json current, ${components} components\n`);
      continue;
    }

    await writeFile(target, serialized);
    process.stdout.write(
      `Wrote ${name}/sbom.json — ${name}@${version}, ${components} shipped components\n`
    );
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
