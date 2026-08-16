import { collectEnvironment } from "./environment.mjs";
import { readCompatibility, supportedPair } from "./installability.mjs";

export async function versions(projectPath) {
  const matrix = await readCompatibility();
  const environment = await collectEnvironment(projectPath);
  const pair = supportedPair(matrix);

  return {
    product: "visp-dev",
    published: matrix.published,
    registryState: matrix.registryState ?? null,
    supportedRelease: pair === null ? null : matrix.supportedRelease,
    installed: { kit: environment.kit, hyper: environment.hyper, node: environment.node },
    supported: pair,
    // Every pair is pinned by commit, never by a version range: a range would
    // let a different build answer to the same name.
    pairs: matrix.pairs.map((pair) => ({
      id: pair.id,
      kit: pair.kit.commit,
      hyper: pair.hyper.commit,
      negotiated: pair.negotiated
    }))
  };
}
