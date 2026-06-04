import {
  runDeployCliEffect,
  type DeployCliOptions,
  type DeployCliResult,
} from "@schematics/example-shared/node";
import { Effect } from "effect";
import { makeMockCatalogApi } from "./api";
import { makeCatalogConfigDeploy } from "./deploy";
import { catalogSeeds, type CatalogSeedName } from "./seed";

export const CATALOG_PROJECT_ID = "nyc-library-yaml";

/**
 * The catalog `pull | plan | apply | destroy | fork | merge` CLI — the generic
 * harness from `@schematics/example-shared/node`, parameterized with a mock API
 * seeded by `--account` (defaults to the NYPL fixture). Runnable and testable
 * without a live backend.
 */
export function runCatalogDeployCliEffect(
  argv: readonly string[],
  options: DeployCliOptions = {},
): Effect.Effect<DeployCliResult> {
  return runDeployCliEffect(
    argv,
    {
      projectId: CATALOG_PROJECT_ID,
      name: "catalog-deploy",
      commitMessage: (flags) => `Pull ${flags.account ?? "nypl"} snapshot`,
      resolveDeploy: ({ store, flags }) =>
        Effect.sync(() => {
          const seedName: CatalogSeedName =
            flags.account && flags.account in catalogSeeds
              ? (flags.account as CatalogSeedName)
              : "nypl";
          const api = makeMockCatalogApi({ seed: catalogSeeds[seedName] });
          return makeCatalogConfigDeploy({ store, api, projectId: CATALOG_PROJECT_ID });
        }),
    },
    options,
  );
}

export function runCatalogDeployCli(
  argv: readonly string[],
  options: DeployCliOptions = {},
): Promise<DeployCliResult> {
  return Effect.runPromise(runCatalogDeployCliEffect(argv, options));
}
