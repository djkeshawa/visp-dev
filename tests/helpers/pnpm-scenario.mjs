/**
 * Stand-in `pnpm` executables that run the real one and then corrupt exactly
 * one field of its output.
 *
 * This is how the fail-closed paths are exercised against real pnpm data: a
 * fabricated tree would only prove the normaliser rejects a document nothing
 * produces. Each scenario names the single contradiction it introduces.
 */
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import {
  snapshotFidelityAvailable,
} from "../../src/toolchain/index.mjs";
import {
  pathExecutable,
} from "./toy-package.mjs";

async function makePnpmScenarioManager(t, scenario) {
  if (!snapshotFidelityAvailable()) {
    t.skip("mode-faithful snapshots are not reproducible on this platform");
    return null;
  }

  const root = await mkdtemp(path.join(tmpdir(), "visp pnpm scenario "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = path.join(root, "pnpm-scenario.mjs");
  const realPnpm = await pathExecutable("pnpm");
  await writeFile(executable, `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const scenario = ${JSON.stringify(scenario)};
const args = process.argv.slice(2);
const noOptional = args.includes("--no-optional");
const cachePath = (suffix) => path.join(process.cwd(), "..", \`\${path.basename(process.cwd())}-\${suffix}.json\`);
const spawnPnpm = (pnpmArgs) => spawnSync(${JSON.stringify(realPnpm)}, pnpmArgs, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
const result = args[0] === "list"
  ? {
      status: 0,
      stderr: "",
      stdout: readFileSync(
        cachePath(scenario === "full_no_optional_contradiction" ? "full" : noOptional ? "no-optional" : "full"),
        "utf8",
      ),
    }
  : spawnPnpm(args);
if (result.status !== 0) {
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exit(result.status ?? 1);
}

const moduleState = path.join(process.cwd(), "node_modules", ".modules.yaml");
const identity = "visp-toy-builder-offline@1.0.0";
const putSkipped = (values) => {
  const source = readFileSync(moduleState, "utf8");
  const start = source.indexOf("\\nskipped:");
  const end = source.indexOf("\\nstoreDir:", start);
  if (start < 0 || end < 0) throw new Error("unexpected pnpm skipped fixture");
  writeFileSync(
    moduleState,
    \`\${source.slice(0, start)}\\nskipped:\\n\${values.map((value) => \`  - \${value}\`).join("\\n")}\${source.slice(end)}\`,
  );
};
if (args[0] === "install") {
  const full = spawnPnpm(["list", "--depth", "Infinity", "--json"]);
  const noOptionalTree = spawnPnpm(["list", "--depth", "Infinity", "--json", "--no-optional"]);
  if (full.status !== 0 || noOptionalTree.status !== 0) throw new Error("could not cache pnpm tree fixtures");
  writeFileSync(cachePath("full"), full.stdout);
  writeFileSync(cachePath("no-optional"), noOptionalTree.stdout);
  if (scenario === "required_missing_skipped" || scenario === "present_skipped") putSkipped([identity]);
  if (scenario === "duplicate_skipped") putSkipped([identity, identity]);
  if (scenario === "malformed_modules") writeFileSync(moduleState, "skipped: [unterminated\\n");
  if (scenario === "wrong_manager") {
    const source = readFileSync(moduleState, "utf8");
    const updated = source.replace(/^packageManager:.*$/mu, "packageManager: pnpm@11.2.0");
    if (updated === source) throw new Error("unexpected pnpm package-manager fixture");
    writeFileSync(moduleState, updated);
  }
  if (scenario === "wrong_store") {
    const source = readFileSync(moduleState, "utf8");
    const updated = source.replace(/^storeDir:.*$/mu, "storeDir: /tmp/visp-foreign-pnpm-store");
    if (updated === source) throw new Error("unexpected pnpm store fixture");
    writeFileSync(moduleState, updated);
  }
  if (scenario === "escaping_nominal_path") {
    const escape = path.join(process.cwd(), "..", "pnpm-nominal-escape");
    try { unlinkSync(escape); } catch (error) { if (error.code !== "ENOENT") throw error; }
    symlinkSync(path.join(process.cwd(), "node_modules", "visp-toy-builder-offline"), escape, "dir");
  }
  if (scenario === "required_child_below_optional") {
    const manifestPath = path.join(process.cwd(), "node_modules", "visp-toy-builder-offline", "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.dependencies = { "visp-required-child": "1.0.0" };
    writeFileSync(manifestPath, \`\${JSON.stringify(manifest, null, 2)}\\n\`);
  }
  if (scenario.startsWith("ordinary_spec:") || [
    "present_peer_edge",
    "optional_peer_edge",
    "malformed_optional_peer_meta",
    "undeclared_edge",
    "ambiguous_peer_edge",
    "peer_identity_mismatch",
  ].includes(scenario)) {
    const rootManifestPath = path.join(process.cwd(), "package.json");
    const rootManifest = JSON.parse(readFileSync(rootManifestPath, "utf8"));
    if (scenario.startsWith("ordinary_spec:")) {
      rootManifest.devDependencies[identity.slice(0, identity.lastIndexOf("@"))] = scenario.slice("ordinary_spec:".length);
    }
    if (["present_peer_edge", "optional_peer_edge", "malformed_optional_peer_meta", "peer_identity_mismatch"].includes(scenario)) {
      delete rootManifest.devDependencies["visp-toy-builder-offline"];
      rootManifest.peerDependencies = { "visp-toy-builder-offline": "~1.0.0" };
    }
    if (scenario === "optional_peer_edge") {
      rootManifest.peerDependenciesMeta = { "visp-toy-builder-offline": { optional: true } };
    }
    if (scenario === "malformed_optional_peer_meta") {
      rootManifest.peerDependenciesMeta = { "visp-toy-builder-offline": { optional: "yes" } };
    }
    if (scenario === "undeclared_edge") delete rootManifest.devDependencies["visp-toy-builder-offline"];
    if (scenario === "ambiguous_peer_edge") {
      rootManifest.peerDependencies = { "visp-toy-builder-offline": ">=1" };
    }
    writeFileSync(rootManifestPath, \`\${JSON.stringify(rootManifest, null, 2)}\\n\`);
  }
}

if (args[0] === "list") {
  const tree = JSON.parse(result.stdout);
  const root = Array.isArray(tree) ? tree[0] : tree;
  const groups = [root.dependencies, root.devDependencies, root.optionalDependencies].filter(Boolean);
  if (scenario === "optional_peer_edge" && noOptional) {
    for (const group of groups) delete group["visp-toy-builder-offline"];
  }
  const builder = groups.map((group) => group["visp-toy-builder-offline"]).find(Boolean);
  if (builder) {
    if (scenario === "required_missing_skipped" || scenario === "optional_missing_not_skipped") {
      builder.path = path.join(process.cwd(), "node_modules", "visp-missing-builder");
    }
    if (scenario === "escaping_nominal_path") {
      builder.path = path.join(process.cwd(), "..", "pnpm-nominal-escape");
    }
    if (scenario === "identity_mismatch") builder.version = "9.9.9";
    if (scenario === "peer_identity_mismatch") builder.from = "visp-peer-impostor";
    if (scenario === "required_child_below_optional") {
      builder.dependencies = {
        "visp-required-child": {
          path: path.join(process.cwd(), "node_modules", "visp-toy-builder-offline", "node_modules", "visp-required-child"),
          version: "1.0.0",
        },
      };
    }
  }
  process.stdout.write(JSON.stringify(tree));
} else {
  process.stdout.write(result.stdout ?? "");
}
process.stderr.write(result.stderr ?? "");
`, { mode: 0o755 });
  return executable;
}

async function makeAliasScenarioManager(t, scenario, alias) {
  if (!snapshotFidelityAvailable()) {
    t.skip("mode-faithful snapshots are not reproducible on this platform");
    return null;
  }

  const root = await mkdtemp(path.join(tmpdir(), "visp pnpm alias scenario "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = path.join(root, "pnpm-alias-scenario.mjs");
  const realPnpm = await pathExecutable("pnpm");
  await writeFile(executable, `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const scenario = ${JSON.stringify(scenario)};
const logicalName = ${JSON.stringify(alias.logicalName)};
const targetName = ${JSON.stringify(alias.targetName)};
const args = process.argv.slice(2);
const noOptional = args.includes("--no-optional");
const cachePath = (suffix) => path.join(process.cwd(), "..", \`\${path.basename(process.cwd())}-alias-\${suffix}.json\`);
const spawnPnpm = (pnpmArgs) => spawnSync(${JSON.stringify(realPnpm)}, pnpmArgs, {
  cwd: process.cwd(),
  env: process.env,
  encoding: "utf8",
  maxBuffer: 2 * 1024 * 1024,
});
const result = args[0] === "list"
  ? {
      status: 0,
      stderr: "",
      stdout: readFileSync(cachePath(noOptional ? "no-optional" : "full"), "utf8"),
    }
  : spawnPnpm(args);
if (result.status !== 0) {
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exit(result.status ?? 1);
}

if (args[0] === "install") {
  const full = spawnPnpm(["list", "--depth", "Infinity", "--json"]);
  const noOptionalTree = spawnPnpm(["list", "--depth", "Infinity", "--json", "--no-optional"]);
  if (full.status !== 0 || noOptionalTree.status !== 0) throw new Error("could not cache pnpm alias trees");
  writeFileSync(cachePath("full"), full.stdout);
  writeFileSync(cachePath("no-optional"), noOptionalTree.stdout);

  const rootManifestPath = path.join(process.cwd(), "package.json");
  const rootManifest = JSON.parse(readFileSync(rootManifestPath, "utf8"));
  if (scenario === "undeclared_alias") delete rootManifest.devDependencies[logicalName];
  if (scenario === "unsupported_alias_spec") rootManifest.devDependencies[logicalName] = \`npm:\${targetName}@~6.0.0\`;
  if (scenario === "malformed_alias_spec") rootManifest.devDependencies[logicalName] = \`npm:\${targetName}\`;
  if (scenario === "out_of_range_alias") rootManifest.devDependencies[logicalName] = \`npm:\${targetName}@^7.0.0\`;
  writeFileSync(rootManifestPath, \`\${JSON.stringify(rootManifest, null, 2)}\\n\`);

  if (scenario === "manifest_mismatch") {
    const targetManifestPath = path.join(process.cwd(), "node_modules", logicalName, "package.json");
    const targetManifest = JSON.parse(readFileSync(targetManifestPath, "utf8"));
    targetManifest.name = \`\${targetName}-impostor\`;
    writeFileSync(targetManifestPath, \`\${JSON.stringify(targetManifest, null, 2)}\\n\`);
  }
}

if (args[0] === "list") {
  const tree = JSON.parse(result.stdout);
  const treeRoot = Array.isArray(tree) ? tree[0] : tree;
  const groups = [treeRoot.dependencies, treeRoot.devDependencies, treeRoot.optionalDependencies].filter(Boolean);
  const dependency = groups.map((group) => group[logicalName]).find(Boolean);
  if (!dependency) throw new Error("expected pnpm alias node is unavailable");
  if (scenario === "target_mismatch") dependency.from = \`\${targetName}-other\`;
  process.stdout.write(JSON.stringify(tree));
} else {
  process.stdout.write(result.stdout ?? "");
}
process.stderr.write(result.stderr ?? "");
`, { mode: 0o755 });
  return executable;
}

export {
  makeAliasScenarioManager,
  makePnpmScenarioManager,
};
