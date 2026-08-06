// Part F3–F5 — visp-dev tells you something you can act on.
//
// A weak-model evaluation drove this tool on a real project and came away
// unable to answer "is my machine set up correctly?". Three separate reasons,
// each independently fixable:
//
//   - `visp-dev --version` did not exist, while every sibling has one and this
//     tool's own doctor reports the versions of the others.
//   - The recovery said `npm install -g visp-kit@0.5.0 visp-hyper-agent@0.8.0`
//     when `npm list -g` showed those exact versions already installed. An
//     instruction that changes nothing reads as "this tool does not know what
//     is on my machine" — and knowing that is its entire job.
//   - `Node: v24.15.0 — no supported pair` named the problem and withheld
//     every fact needed to act on it.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { installability, supportedNodeRanges } from "../src/cli.mjs";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const BIN = join(here, "..", "scripts", "visp-dev.mjs");

test("visp-dev reports its own version", async () => {
  const { stdout } = await execFileAsync(process.execPath, [BIN, "--version"]);
  assert.match(
    stdout.trim(),
    /^visp-dev \d+\.\d+\.\d+/u,
    `--version printed: ${stdout.trim()}`
  );
});

test("-v is accepted as well", async () => {
  const { stdout } = await execFileAsync(process.execPath, [BIN, "-v"]);
  assert.match(stdout.trim(), /^visp-dev \d+\.\d+\.\d+/u);
});

const supersededMatrix = {
  published: false,
  supportedRelease: null,
  pairs: [{ id: "phase-6", node: ">=22" }],
  registryState: {
    supersedesEvidencedPair: true,
    npm: { "visp-kit": "0.5.0", "visp-hyper-agent": "0.8.0" },
    hazard: "Do not mix the pairs."
  }
};

test("does not recommend installing versions that are already installed", () => {
  const guidance = installability(supersededMatrix, {
    kit: "0.5.0",
    hyper: "0.8.0"
  }).guidance;

  assert.ok(
    /already have/u.test(guidance),
    `Recovery still tells a user to install what they have:\n${guidance}`
  );
  assert.ok(
    !/npm install -g visp-kit@0\.5\.0/u.test(guidance),
    `Recovery contains a no-op install command:\n${guidance}`
  );
});

test("still names the install command when the versions differ", () => {
  // The converse. Suppressing the command whenever anything is installed would
  // strand the user who genuinely has the wrong pair.
  const guidance = installability(supersededMatrix, {
    kit: "0.2.3",
    hyper: "0.8.0"
  }).guidance;

  assert.ok(
    /npm install -g visp-kit@0\.5\.0 visp-hyper-agent@0\.8\.0/u.test(guidance),
    `Recovery withheld the install command from a user who needs it:\n${guidance}`
  );
});

test("still names the install command when nothing is installed at all", () => {
  const guidance = installability(supersededMatrix, { kit: null, hyper: null }).guidance;
  assert.ok(/npm install -g/u.test(guidance), guidance);
});

test("names the Node versions the matrix requires", () => {
  assert.equal(supportedNodeRanges(supersededMatrix), " (the pairs in this matrix require >=22)");
});

test("says nothing rather than something empty when there are no pairs", () => {
  assert.equal(supportedNodeRanges({ pairs: [] }), "");
  assert.equal(supportedNodeRanges({}), "");
});
