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
import { join } from "node:path";
import test from "node:test";

import { collectEnvironment } from "../src/cli.mjs";

async function fakeBinary(dir, name, version) {
  if (process.platform === "win32") {
    await writeFile(join(dir, `${name}.cmd`), `@echo off\r\necho ${version}\r\n`, "utf8");
    return;
  }
  const file = join(dir, name);
  await writeFile(file, `#!/bin/sh\necho "${version}"\n`, "utf8");
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

async function environmentOn(binDir) {
  const original = process.env.PATH;
  process.env.PATH = binDir;
  try {
    return await collectEnvironment(await mkdtemp(join(tmpdir(), "visp-dev-proj-")));
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
