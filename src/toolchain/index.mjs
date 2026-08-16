/**
 * THE SLICE A CONTRACT. Slices B and C import this and nothing deeper.
 *
 * The list is additive: a name here does not disappear without the consumers
 * moving first.
 *
 * WHAT IS DELIBERATELY NOT UNIFIED. The matrix's scenario runners and the
 * authored-workflow runners differ in timeout, command lookup and failure
 * payload, and every pinned row was produced under one exact pairing. They are
 * exposed separately (`runExact` vs `project-fixture`'s private scenario
 * runners, `parseFrame` vs `parseExactFrame`) rather than merged. See the
 * headers of `cli-output.mjs` and `project-fixture.mjs`.
 */

export {
  canonicalStringify,
  sha256Hex,
} from "../platform/canonical-json.mjs";

export {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  assertPlainRecord,
  compareText,
  findExecutable,
  rejectUnknownKeys,
  requireZero,
  resolveSpawn,
  runChecked,
  runExact,
  runProcess,
  stableEnvironment,
  trimLine,
} from "./process.mjs";

export {
  cleanupOwnedRoot,
  createOwnedRoot,
  findOwnedRoot,
  isWithin,
  requireOwnedPath,
} from "./owned-root.mjs";

export {
  resolveCommit,
  runGit,
  snapshotCommit,
  snapshotFidelityAvailable,
} from "./git-snapshot.mjs";

export {
  normalizeBins,
  packageIdentity,
} from "./manifest.mjs";

export {
  cacheInventory,
  npmEnvironment,
  prepareOfflineCache,
  snapshotOfflineStore,
} from "./npm-environment.mjs";

export {
  assertMatchingPacks,
  packPackageTwice,
  packageSnapshot,
  readPackedManifest,
} from "./npm-pack.mjs";

export {
  inspectInstalledBins,
  installLocalTarball,
  runInstalledBin,
} from "./npm-install.mjs";

export {
  compareVersions,
  parseAuthoredDependencySpec,
  parseStableExactVersion,
  validateExactVersion,
  validatePackageName,
  versionSatisfiesSpec,
} from "./lockfile/semver.mjs";

export {
  installedDependencyTree,
  normalizeDependencyTree,
  prepareOfflineInstallLock,
} from "./lockfile/npm.mjs";

export { preparedDependencyTree } from "./lockfile/pnpm.mjs";

export { verifyInstalledLockGraph } from "./lockfile/graph.mjs";

export { materializeRuntimeInstallLock } from "./runtime-lock.mjs";

export {
  defaultBinName,
  executionEnvironment,
  packAndInstall,
  pathCommand,
  toolVersion,
} from "./pair-install.mjs";

export {
  createRealProject,
  createScenarioProject,
  readArtifactBinding,
} from "./project-fixture.mjs";

export {
  canonicalActionAbsent,
  parseAuthorityStopReason,
  parseExactFrame,
  parseFrame,
  parseHyperEnvelope,
  parseJson,
  parseJsonOutput,
  parseLegacyAction,
  requireCompleted,
} from "./cli-output.mjs";

export { runCompatibilityLab } from "./lab.mjs";
