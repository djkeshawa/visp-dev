import assert from "node:assert/strict";
import test from "node:test";

import { formatDoctor } from "../../../src/cli/format.mjs";

test("doctor reports a deprecated install as failed, not ok", () => {
  const report = {
    status: "failed",
    checks: [
      {
        name: "Visp Kit",
        value: "0.1.0",
        status: "deprecated",
        detail: "visp-kit@0.1.0 is deprecated and unsupported."
      }
    ],
    recovery: ["Uninstall visp-kit@0.1.0"],
    supportedRelease: { kit: "0.2.3", hyper: "0.4.3" }
  };
  const text = formatDoctor(report);

  assert.match(text, /failed/u);
  assert.match(text, /\[deprecated\]/u);
  assert.match(text, /Recovery:/u);
  assert.match(text, /supported release: visp-kit@0\.2\.3 \+ visp-hyper-agent@0\.4\.3/u);
});

test("doctor formatting never names a release when none is recommended", () => {
  const incomplete = formatDoctor({ status: "blocked", checks: [], recovery: [], supportedRelease: null });

  assert.match(incomplete, /supported release: none \(evidence incomplete\)/u);
  assert.doesNotMatch(incomplete, /0\.2\.3|0\.4\.3/u);

  // A superseded pair is a distinct state: the evidence is complete and valid,
  // it just no longer describes what a user should install. Calling that
  // "incomplete" would misdescribe it.
  const superseded = formatDoctor({
    status: "blocked",
    checks: [],
    recovery: [],
    supportedRelease: null,
    registryState: { supersedesEvidencedPair: true }
  });

  assert.match(superseded, /supported release: none \(evidenced pair superseded on the registry\)/u);
  assert.doesNotMatch(superseded, /0\.2\.3|0\.4\.3/u);
});
