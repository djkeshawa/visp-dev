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

test("a reported version is printed with the file it was read from", () => {
  // LC-95: on a machine carrying two installations of one product, the version
  // alone leaves the reader inferring which one answered.
  const text = formatDoctor({
    status: "unknown",
    statusReason: "the matrix holds no evidence about the versions installed",
    checks: [
      {
        name: "Visp Hyper Agent",
        value: "0.9.0",
        path: "/usr/local/bin/visp",
        status: "unverified",
        detail: "also on PATH: visp-hyper 0.8.0 at /opt/node/bin/visp-hyper"
      }
    ],
    recovery: [],
    supportedRelease: null
  });

  assert.match(text, /Visp Hyper Agent: 0\.9\.0\s+\(\/usr\/local\/bin\/visp\)/u);
  assert.match(text, /visp-hyper 0\.8\.0 at \/opt\/node\/bin\/visp-hyper/u);
});

test("the verdict is printed with what it means", () => {
  // "blocked" alone read as a refusal whatever produced it, which is how "no
  // evidence about your versions" and "nothing is installed" became one word.
  const text = formatDoctor({
    status: "unknown",
    statusReason: "nothing is wrong here; the matrix simply holds no evidence",
    checks: [],
    recovery: [],
    supportedRelease: null
  });

  assert.match(text, /visp-dev doctor: unknown — nothing is wrong here/u);
});

test("a report without a stated meaning still prints a clean verdict line", () => {
  // The JSON is the contract; format must not render "undefined" for a field a
  // caller did not set.
  const text = formatDoctor({ status: "blocked", checks: [], recovery: [], supportedRelease: null });

  assert.match(text, /^visp-dev doctor: blocked$/mu);
  assert.doesNotMatch(text, /undefined/u);
});

test("a check without a resolved path prints no empty parentheses", () => {
  const text = formatDoctor({
    status: "blocked",
    checks: [{ name: "Visp Kit", value: "not found on PATH", path: null, status: "unavailable" }],
    recovery: [],
    supportedRelease: null
  });

  assert.match(text, /Visp Kit: not found on PATH$/mu);
});
