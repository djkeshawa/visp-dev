import assert from "node:assert/strict";
import test from "node:test";

import { formatVersions } from "../../../src/cli/format.mjs";
import { versions } from "../../../src/cli/versions.mjs";

test("versions keeps every pair pinned by commit and names a release only when one is recommended", async () => {
  const result = await versions(process.cwd());

  assert.equal(result.published, true);
  assert.ok(result.pairs.length >= 3);
  for (const pair of result.pairs) {
    assert.match(pair.kit, /^[0-9a-f]{40}$/u);
    assert.match(pair.hyper, /^[0-9a-f]{40}$/u);
  }

  // LC-95: the two surfaces that report installed versions must report them
  // the same way. `versions` printing a bare number while `doctor` prints the
  // resolved path is how a reader ends up comparing two different machines.
  const text = formatVersions(result);
  for (const [version, filePath] of [
    [result.installed.kit, result.installed.kitPath],
    [result.installed.hyper, result.installed.hyperPath]
  ]) {
    if (version === null) continue;
    assert.ok(filePath, `${version} was reported without the file it was read from`);
    assert.ok(text.includes(filePath), `formatVersions dropped the resolved path ${filePath}`);
  }

  // Once the evidenced pair is superseded on the registry, `versions` must not
  // print a supported release at all — printing the older one is the failure
  // mode this guards.
  if (result.supportedRelease === null) {
    assert.doesNotMatch(formatVersions(result), /supported release:\s+visp-kit@/u);
  } else {
    assert.match(
      formatVersions(result),
      new RegExp(
        `supported release:\\s+visp-kit@${result.supportedRelease.kit} \\+ visp-hyper-agent@${result.supportedRelease.hyper}`,
        "u"
      )
    );
  }
});
