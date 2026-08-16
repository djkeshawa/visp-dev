import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";

import {
  cleanupOwnedRoot,
  createOwnedRoot,
} from "../../../src/toolchain/index.mjs";

test("owned-root cleanup rejects foreign paths and supports explicit keep", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "visp-owned-parent-"));
  try {
    const kept = await createOwnedRoot({ baseDirectory: parent });
    assert.equal((await cleanupOwnedRoot({ root: kept.root, keep: true })).kept, true);
    assert.ok(await stat(kept.root));
    assert.equal((await cleanupOwnedRoot({ root: kept.root })).kept, false);
    await assert.rejects(stat(kept.root), { code: "ENOENT" });

    const foreign = path.join(parent, "foreign");
    await mkdir(foreign);
    await assert.rejects(cleanupOwnedRoot({ root: foreign }), /not owned/i);
    assert.ok(await stat(foreign));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
