import {
  runDeployCliEffect,
  type DeployCliOptions,
  type DeployCliResult,
} from "@schematics/deploy/node";
import { Effect } from "effect";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { makeMockCatalogApi, type CatalogSeed, type MockCatalogApi } from "./api";
import { makeCatalogConfigDeploy } from "./deploy";
import { catalogSeeds, type CatalogSeedName } from "./seed";

export const CATALOG_PROJECT_ID = "nyc-library-yaml";

/**
 * The catalog `pull | plan | apply | destroy | fork | merge` CLI — the generic
 * harness from `@schematics/deploy/node`, parameterized with a mock API
 * seeded by `--account` (defaults to the NYPL fixture). Pass `--mock-state
 * <file>` to persist the mock remote across invocations (so applies and
 * out-of-band drift survive), which the fork/merge walkthrough relies on.
 */
export function runCatalogDeployCliEffect(
  argv: readonly string[],
  options: DeployCliOptions = {},
): Effect.Effect<DeployCliResult> {
  // Shared between resolveDeploy and afterMutate so the snapshot saved after a
  // mutation reflects the same in-memory mock the command ran against.
  let persistent: { readonly path: string; readonly api: MockCatalogApi } | null = null;

  return runDeployCliEffect(
    argv,
    {
      projectId: CATALOG_PROJECT_ID,
      name: "catalog-deploy",
      commitMessage: (flags) => `Pull ${flags.account ?? "nypl"} snapshot`,
      resolveDeploy: ({ store, flags }) =>
        Effect.gen(function* () {
          const seedName: CatalogSeedName =
            flags.account && flags.account in catalogSeeds
              ? (flags.account as CatalogSeedName)
              : "nypl";
          const mockState =
            typeof flags.rest["mock-state"] === "string" ? flags.rest["mock-state"] : null;

          let api: MockCatalogApi;
          if (mockState) {
            const seed = yield* readSeedOrDefault(mockState, catalogSeeds[seedName]);
            api = makeMockCatalogApi({ seed });
            persistent = { path: mockState, api };
          } else {
            api = makeMockCatalogApi({ seed: catalogSeeds[seedName] });
          }
          return makeCatalogConfigDeploy({ store, api, projectId: CATALOG_PROJECT_ID });
        }),
      afterMutate: () => (persistent ? saveSnapshot(persistent.path, persistent.api) : Effect.void),
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

function readSeedOrDefault(path: string, fallback: CatalogSeed): Effect.Effect<CatalogSeed> {
  return Effect.tryPromise({
    try: async () => JSON.parse(await readFile(path, "utf8")) as CatalogSeed,
    catch: (error) => error,
  }).pipe(Effect.orElseSucceed(() => fallback));
}

function saveSnapshot(path: string, api: MockCatalogApi): Effect.Effect<void> {
  return Effect.gen(function* () {
    const snapshot = yield* api.snapshot;
    yield* Effect.promise(async () => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`);
    });
  });
}
