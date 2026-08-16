/**
 * Reading structured output back out of a foreign binary's stdout.
 *
 * TWO frame parsers live here on purpose. `parseFrame` matches a newline-
 * delimited frame with a regex and requires exactly one match anywhere in the
 * stream; `parseExactFrame` finds the delimiters by index and requires the
 * opening delimiter to appear exactly once. They accept different documents —
 * a frame whose body is on the same line as its delimiter passes the second
 * and fails the first — and the suites that use each were pinned against real
 * output from the pair. Collapsing them to one would change what some suite
 * accepts without any test saying so.
 */
/** JSON on stdout, with the label naming which command failed to produce it. */
export function parseJson(result, label) {
  try {
    return JSON.parse(result.stdout.text);
  } catch {
    throw new Error(`${label} did not emit JSON`);
  }
}

/** As `parseJson`, but truncated capture is an error rather than a parse failure. */
export function parseJsonOutput(result, label) {
  if (result.stdout.truncated) throw new Error(`${label} output was truncated`);
  try {
    return JSON.parse(result.stdout.text);
  } catch {
    throw new Error(`${label} did not emit JSON`);
  }
}

/** Exactly one newline-delimited `begin`/`end` frame, parsed as JSON. */
export function parseFrame(result, begin, end, label) {
  const pattern = new RegExp(`${begin}\\n([\\s\\S]*?)\\n${end}`, "gu");
  const matches = [...result.stdout.text.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`${label} did not emit exactly one canonical frame`);
  try {
    return JSON.parse(matches[0][1]);
  } catch {
    throw new Error(`${label} emitted malformed canonical JSON`);
  }
}

/** Exactly one `begin`/`end` frame located by index, body trimmed, parsed as JSON. */
export function parseExactFrame(result, begin, end, label) {
  const start = result.stdout.text.indexOf(begin);
  const finish = result.stdout.text.indexOf(end);
  if (start === -1 || finish === -1 || finish <= start
    || result.stdout.text.indexOf(begin, start + begin.length) !== -1) {
    throw new Error(`${label} did not emit one exact frame`);
  }
  const body = result.stdout.text.slice(start + begin.length, finish).trim();
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${label} frame body was malformed`);
  }
}

export function parseLegacyAction(result) {
  return parseExactFrame(
    result,
    "BEGIN_VISP_WORKFLOW_ACTION_V2",
    "END_VISP_WORKFLOW_ACTION_V2",
    "Hyper legacy action",
  );
}

export function parseHyperEnvelope(result) {
  return parseExactFrame(
    result,
    "BEGIN_VISP_HYPER_ACTION_V1",
    "END_VISP_HYPER_ACTION_V1",
    "Hyper canonical action",
  );
}

/**
 * The one `reason_code` inside Kit's authority-stop frame.
 *
 * Both delimiters are required to appear exactly once, and exactly one reason
 * line must be inside. A second frame would mean the run stopped twice and the
 * first reason silently won.
 */
export function parseAuthorityStopReason(result, label) {
  const begin = "BEGIN_VISP_KIT_AUTHORITY_RESULT";
  const end = "END_VISP_KIT_AUTHORITY_RESULT";
  const text = result.stdout.text;
  const start = text.indexOf(begin);
  const finish = text.indexOf(end);
  if (start === -1 || finish === -1 || finish <= start
    || text.indexOf(begin, start + begin.length) !== -1
    || text.indexOf(end, finish + end.length) !== -1) {
    throw new Error(`${label} did not emit one exact authority-stop frame`);
  }
  const matches = [...text.slice(start + begin.length, finish).matchAll(/^reason_code: ([a-z0-9_]+)$/gmu)];
  if (matches.length !== 1) {
    throw new Error(`${label} did not emit one exact authority-stop reason`);
  }
  return matches[0][1];
}

/** Whether neither canonical action frame is present at all. */
export function canonicalActionAbsent(result) {
  return !/BEGIN_VISP_(?:HYPER_ACTION_V1|WORKFLOW_ACTION_V2)/u.test(result.stdout.text);
}

/**
 * The command RAN, whatever it decided.
 *
 * Distinct from `requireZero`: a scaffolding step that legitimately exits
 * non-zero still has to have started, and treating "did not run" as "decided
 * no" is how a fixture records a verdict nothing produced.
 */
export function requireCompleted(result, label) {
  if (result.spawnError || result.timedOut || !Number.isInteger(result.exitCode)) {
    const error = new Error(`${label} did not complete`);
    error.observation = result;
    throw error;
  }
  return result;
}
