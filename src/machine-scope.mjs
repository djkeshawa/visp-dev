// P10-US-08: the machine-scope adapter (visp-dev ADR 0001, accepted D-116).
//
// This module is the ONLY public surface Visp Dev exposes to the coordinator,
// and only the `setup` and `doctor` verbs may load it — never a project-scope
// verb. It owns machine-scope work: verifying the installed pair and
// registering the MCP host entry. It decides nothing about any project's
// workflow; Kit decides, Hyper presents, this installs.
//
// D-118 file rule applies to everything written here: never overwrite content
// a user changed, never leave a broken state silently — refuse and print the
// exact replacement instead.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { detectTool } from "./cli.mjs";

// The D-118 final train: renamed Kit is driven by final Hyper.
const REQUIRED = {
  kit: { binary: "visp-kit", floor: [0, 4] },
  hyper: { binary: "visp", floor: [0, 7] }
};

function parseVersion(text) {
  const match = /(\d+)\.(\d+)\.(\d+)/u.exec(`${text ?? ""}`);
  return match === null
    ? null
    : [Number.parseInt(match[1], 10), Number.parseInt(match[2], 10), Number.parseInt(match[3], 10)];
}

function meetsFloor(version, floor) {
  if (version === null) return false;
  if (version[0] !== floor[0]) return version[0] > floor[0];
  return version[1] >= floor[1];
}

const MCP_SERVER_ENTRY = {
  command: "visp",
  args: ["serve", "--mcp"]
};

/**
 * Register the Visp MCP server in the project's `.mcp.json`.
 * Missing file → written. Present without a `visp` entry → merged. Present
 * with a DIFFERENT `visp` entry → refused with the exact replacement printed;
 * the user's configuration is never overwritten (D-118).
 */
async function registerMcp(projectPath) {
  const mcpPath = join(projectPath, ".mcp.json");
  let existing = null;
  try {
    existing = JSON.parse(await readFile(mcpPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      return {
        ok: false,
        line: `.mcp.json exists but is not valid JSON. Fix it by hand, then add: "visp": ${JSON.stringify(MCP_SERVER_ENTRY)}`
      };
    }
  }

  if (existing !== null && typeof existing === "object") {
    const current = existing.mcpServers?.visp;
    if (current !== undefined) {
      if (JSON.stringify(current) === JSON.stringify(MCP_SERVER_ENTRY)) {
        return { ok: true, line: ".mcp.json already registers the visp MCP server." };
      }
      return {
        ok: false,
        line:
          `.mcp.json carries a modified visp entry; it was left untouched. ` +
          `The current entry is: "visp": ${JSON.stringify(MCP_SERVER_ENTRY)}`
      };
    }
    const merged = {
      ...existing,
      mcpServers: { ...(existing.mcpServers ?? {}), visp: MCP_SERVER_ENTRY }
    };
    await writeFile(mcpPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    return { ok: true, line: "Added the visp MCP server to the existing .mcp.json." };
  }

  await writeFile(
    mcpPath,
    `${JSON.stringify({ mcpServers: { visp: MCP_SERVER_ENTRY } }, null, 2)}\n`,
    "utf8"
  );
  return { ok: true, line: "Wrote .mcp.json registering the visp MCP server." };
}

export async function runSetup({ projectPath, args = [] }) {
  void args;
  const lines = [];
  let success = true;

  const kitVersion = await detectTool(REQUIRED.kit.binary);
  const hyperVersion = await detectTool(REQUIRED.hyper.binary);

  if (kitVersion === null) {
    success = false;
    lines.push(
      "visp-kit: not installed. Install it with: npm install -g visp-kit  (the engine — it decides)."
    );
  } else if (!meetsFloor(parseVersion(kitVersion), REQUIRED.kit.floor)) {
    success = false;
    lines.push(
      `visp-kit: ${kitVersion} is below the matched pair floor 0.4.0. Upgrade: npm install -g visp-kit@latest`
    );
  } else {
    lines.push(`visp-kit: ${kitVersion} — ok.`);
  }

  if (hyperVersion === null) {
    success = false;
    lines.push(
      "visp (coordinator): not installed. Install it with: npm install -g visp-hyper-agent"
    );
  } else if (!meetsFloor(parseVersion(hyperVersion), REQUIRED.hyper.floor)) {
    success = false;
    lines.push(
      `visp (coordinator): ${hyperVersion} is below the matched pair floor 0.7.0. Upgrade: npm install -g visp-hyper-agent@latest`
    );
  } else {
    lines.push(`visp (coordinator): ${hyperVersion} — ok.`);
  }

  // Memory is optional by design (D-118): report, never fail on absence.
  const memoryVersion = await detectTool("visp-memory");
  lines.push(
    memoryVersion === null
      ? "visp-memory: not installed (optional). recall/learn will refuse visibly until it is."
      : `visp-memory: ${memoryVersion} — ok (recall/learn available).`
  );

  if (success) {
    const mcp = await registerMcp(projectPath);
    lines.push(mcp.line);
    if (!mcp.ok) success = false;
  } else {
    lines.push("MCP registration skipped until the pair is installed.");
  }

  lines.push(
    success
      ? "Setup complete. Run visp doctor any time to re-verify."
      : "Setup incomplete — fix the lines above, then re-run visp setup."
  );
  return { success, report: lines.join("\n") };
}
