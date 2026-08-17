// P13 — doctor must not report one product's version as another's.
//
// `collectEnvironment` resolves Kit as `kitRenamed ?? kitLegacy`, where the
// legacy probe is `detectTool("visp")`. Before the D-118 rename that fallback
// was right: `visp` WAS Kit. After it, `visp` is the Hyper dispatcher — so on a
// machine with Hyper installed and Kit absent, the fallback finds Hyper,
// assigns it to `kit`, and doctor prints Hyper's version as Kit's.
//
// The failure mode is the one this project keeps producing: a check that
// reports confidently about something other than the thing it names. Doctor's
// entire job is telling you what is installed. A doctor that invents a missing
// product is worse than one that says nothing, because the user stops looking
// for the real problem — and the guidance that follows is computed from the
// same wrong fact, so it recommends against installing what they actually need.
//
// This is my own code, and the same defect I fixed in visp-dev two days ago
// wearing a different hat.

import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import { collectEnvironment, detectTool, pathIndexOf } from "../../../src/cli/environment.mjs";

/** The on-disk filename PATH resolution will find for `name` on this platform. */
function executable(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

async function fakeBinary(dir, name, version) {
  if (process.platform === "win32") {
    await writeFile(join(dir, `${name}.cmd`), `@echo off\r\necho ${version}\r\n`, "utf8");
    return;
  }
  const file = join(dir, name);
  await writeFile(file, `#!/bin/sh\necho "${version}"\n`, "utf8");
  await chmod(file, 0o755);
}

/** On PATH, executable, and unable to report a version. */
async function brokenBinary(dir, name) {
  if (process.platform === "win32") {
    await writeFile(join(dir, `${name}.cmd`), "@echo off\r\nexit /b 1\r\n", "utf8");
    return;
  }
  const file = join(dir, name);
  await writeFile(file, "#!/bin/sh\nexit 1\n", "utf8");
  await chmod(file, 0o755);
}

/** A machine containing exactly the named binaries and nothing else. */
async function machine(versions) {
  const binDir = await mkdtemp(join(tmpdir(), "visp-dev-identity-"));
  for (const [name, version] of Object.entries(versions)) {
    await fakeBinary(binDir, name, version);
  }
  return binDir;
}

/** `collectEnvironment` seeing exactly `binDirs`, in that PATH order. */
async function environmentOn(...binDirs) {
  const original = process.env.PATH;
  process.env.PATH = binDirs.join(delimiter);
  try {
    return await collectEnvironment(await mkdtemp(join(tmpdir(), "visp-dev-proj-")));
  } finally {
    process.env.PATH = original;
  }
}

/** What a user's shell would run for `name` on this PATH, read the same way. */
async function shellRuns(name, ...binDirs) {
  const original = process.env.PATH;
  process.env.PATH = binDirs.join(delimiter);
  try {
    return await detectTool(name);
  } finally {
    process.env.PATH = original;
  }
}

test("doctor does not report Hyper's version as Kit's when Kit is absent", async () => {
  // The exact machine a user has after installing only the coordinator:
  // `visp` and `visp-hyper` present, `visp-kit` nowhere.
  const binDir = await machine({ visp: "0.8.0", "visp-hyper": "0.8.0" });

  const environment = await environmentOn(binDir);

  assert.equal(
    environment.kit,
    null,
    `doctor reported Kit as "${environment.kit}" on a machine where visp-kit is not installed. ` +
      "The `visp` fallback finds the Hyper dispatcher, so the user is told the engine is " +
      "present when it is not — and every recommendation downstream is computed from that."
  );
  assert.equal(
    environment.hyper,
    "0.8.0",
    "Hyper must still be detected; the fix is to stop misattributing it, not to stop seeing it."
  );
});

test("Kit is reported when visp-kit really is installed", async () => {
  // The converse. Refusing to ever report Kit would satisfy the test above.
  const binDir = await machine({ "visp-kit": "0.5.0", visp: "0.8.0", "visp-hyper": "0.8.0" });

  const environment = await environmentOn(binDir);

  assert.equal(environment.kit, "0.5.0", "doctor failed to detect an installed visp-kit");
  assert.equal(environment.hyper, "0.8.0");
});

test("an empty machine reports neither product", async () => {
  const environment = await environmentOn(await machine({}));

  assert.equal(environment.kit, null);
  assert.equal(environment.hyper, null);
});

test("a genuine pre-rename Kit on `visp` is still detected", async () => {
  // The reason the fallback cannot simply be deleted. Before D-118, `visp` WAS
  // Kit, and those users are precisely the ones who need doctor to work — they
  // are the ones who have not upgraded. Hyper is absent here, so nothing can be
  // mistaking one for the other.
  const binDir = await machine({ visp: "0.2.3" });

  const environment = await environmentOn(binDir);

  assert.equal(
    environment.kit,
    "0.2.3",
    "Dropping the legacy fallback would blind doctor on every pre-rename install."
  );
  assert.equal(environment.hyper, null);
});

test("legacy Kit is still detected when Hyper is also installed", async () => {
  // Here `visp` is legacy Kit and `visp-hyper` is the coordinator, so the two
  // report different versions and both must be reported truthfully.
  const binDir = await machine({ visp: "0.2.3", "visp-hyper": "0.8.0" });

  const environment = await environmentOn(binDir);

  assert.equal(environment.kit, "0.2.3");
  assert.equal(environment.hyper, "0.8.0");
});

test("Kit alone is reported without inventing Hyper", async () => {
  // The mirror of the headline case, so the fix cannot be a blanket rule that
  // happens to zero out whichever field was wrong in the reported scenario.
  const binDir = await machine({ "visp-kit": "0.5.0" });

  const environment = await environmentOn(binDir);

  assert.equal(environment.kit, "0.5.0");
  assert.equal(environment.hyper, null);
});

// ---------------------------------------------------------------------------
// LC-95 — the version reported must be the version the shell runs.
//
// In battleground round two, `visp --version` printed 0.9.0 and `visp-dev
// doctor` reported Hyper 0.8.0 in the same shell. Kit resolved from PATH; Hyper
// was probed only under `visp-hyper`, which the round's shims did not provide,
// so it fell through to a stale global install. Two products, two resolution
// strategies, one wrong answer — and a compatibility verdict about an
// installation nobody is using is worth nothing.
// ---------------------------------------------------------------------------

test("the reported version is the one the binary on PATH prints", async () => {
  // The reported machine, rebuilt: a first PATH entry carrying the current pair
  // as `visp-kit` and the `visp` dispatcher, and a later entry carrying an
  // older global install that still answers to `visp-hyper`.
  const shims = await machine({ "visp-kit": "0.6.0", visp: "0.9.0" });
  const stale = await machine({ "visp-hyper": "0.8.0", "visp-kit": "0.5.0" });

  const environment = await environmentOn(shims, stale);

  assert.equal(
    environment.hyper,
    await shellRuns("visp", shims, stale),
    "doctor reported a Hyper version the user's shell does not run. That is the whole defect: " +
      "every compatibility statement below it describes an installation nobody is using."
  );
  assert.equal(environment.hyper, "0.9.0");
  assert.equal(
    environment.kit,
    await shellRuns("visp-kit", shims, stale),
    "Kit must be resolved by the same rule, not merely happen to be right"
  );
  assert.equal(environment.kit, "0.6.0");
});

test("each reported version carries the path it was read from", async () => {
  const shims = await machine({ "visp-kit": "0.6.0", visp: "0.9.0" });
  const stale = await machine({ "visp-hyper": "0.8.0" });

  const { resolved } = await environmentOn(shims, stale);

  assert.equal(resolved.kit.path, join(shims, executable("visp-kit")));
  assert.equal(
    resolved.hyper.path,
    join(shims, executable("visp")),
    "the path must name the file that printed the version, so the two cannot describe " +
      "different installations"
  );
});

test("a second installation of the same product is named, not silently dropped", async () => {
  // Picking a winner is not enough. The user still has two Hypers on PATH, and
  // the point of the ticket is that the mismatch is visible rather than inferred.
  const shims = await machine({ "visp-kit": "0.6.0", visp: "0.9.0" });
  const stale = await machine({ "visp-hyper": "0.8.0" });

  const { resolved } = await environmentOn(shims, stale);

  assert.equal(resolved.hyper.conflict, true, "two Hyper versions on PATH must register as a conflict");
  assert.deepEqual(
    resolved.hyper.candidates.map((candidate) => `${candidate.command} ${candidate.version}`),
    ["visp 0.9.0", "visp-hyper 0.8.0"],
    "both installations must be reported, in the order PATH would reach them"
  );
  assert.equal(resolved.kit.conflict, false, "one Kit on PATH is not a conflict");
});

test("PATH order decides, exactly as the shell decides", async () => {
  // The same two directories, swapped. Nothing about the machine changed except
  // which entry comes first, and the answer has to follow it.
  const newer = await machine({ visp: "0.9.0", "visp-kit": "0.6.0" });
  const older = await machine({ "visp-hyper": "0.8.0", "visp-kit": "0.5.0" });

  assert.equal((await environmentOn(newer, older)).hyper, "0.9.0");
  assert.equal((await environmentOn(older, newer)).hyper, "0.8.0");
  assert.equal((await environmentOn(newer, older)).kit, "0.6.0");
  assert.equal((await environmentOn(older, newer)).kit, "0.5.0");
});

test("a binary outside every PATH entry loses to one inside", () => {
  // pathIndexOf is what orders the candidates, so its fallback has to lose
  // rather than win by sorting first.
  const path = process.env.PATH ?? "";
  assert.ok(pathIndexOf(join("/nowhere", "visp"), path) > 0);
  assert.equal(pathIndexOf(join("/first", "visp"), ["/first", "/second"].join(delimiter)), 0);
  assert.equal(pathIndexOf(join("/second", "visp"), ["/first", "/second"].join(delimiter)), 1);
});

test("nothing is reported for a name that is on PATH but cannot run", async () => {
  // findExecutable answering is not the same as the binary answering. A file
  // that exits non-zero must not be reported as an installed version.
  const binDir = await mkdtemp(join(tmpdir(), "visp-dev-broken-"));
  await brokenBinary(binDir, "visp-kit");

  const environment = await environmentOn(binDir);

  assert.equal(environment.kit, null);
  assert.equal(environment.resolved.kit.candidates.length, 0);
});
