import type { ArtifactStore } from "@schematics/artifacts";
import {
  makeConfigDeployService,
  toDeployError,
  type ConnectedDeploy,
  type DeploySecretStore,
} from "@schematics/example-shared";
import type { DeployConnectRequest, SchematicsDeployService } from "@schematics/protocol";
import { type Duration, Effect } from "effect";
import { makeMockCatalogApi, type CatalogApi } from "./api";
import { CATALOG_CONNECTION_OPTIONS } from "./connection";
import { CATALOG_KINDS, makeCatalogConfigDeploy } from "./deploy";
import { nycPublicLibrarySeed } from "./seed";

export interface CatalogDeployServiceOptions {
  readonly store: ArtifactStore;
  /**
   * Build the API adapter from the connection request (a live adapter would hold
   * the token). Defaults to the in-memory mock seeded with the NYPL fixture.
   */
  readonly apiFactory?: ((request: DeployConnectRequest) => CatalogApi) | undefined;
  readonly secrets?: DeploySecretStore | undefined;
  readonly lockfilePath?: string | undefined;
  readonly projectId?: string | undefined;
  readonly now?: (() => string) | undefined;
  /** Global API throttle shared across pull and push (see {@link CatalogConfigDeployOptions}). */
  readonly throttle?: { readonly interval?: Duration.Input } | undefined;
}

/**
 * The catalog's deploy service: the generic config-as-code service from
 * `@schematics/example-shared`, parameterized only with the catalog's
 * connection options, kinds, and an engine builder that probes for the catalog
 * name as the account label.
 */
export function makeCatalogDeployService(
  options: CatalogDeployServiceOptions,
): SchematicsDeployService {
  const apiFactory =
    options.apiFactory ?? (() => makeMockCatalogApi({ seed: nycPublicLibrarySeed }));
  return makeConfigDeployService({
    store: options.store,
    connectionOptions: CATALOG_CONNECTION_OPTIONS,
    defaultKinds: [...CATALOG_KINDS],
    consumer: "catalog",
    secrets: options.secrets,
    now: options.now,
    connect: (request, store) =>
      Effect.gen(function* () {
        const api = apiFactory(request);
        // Live probe: validate the connection + resolve the catalog label.
        const catalogs = yield* api.catalog.list.pipe(Effect.mapError(toDeployError));
        const account = catalogs[0]?.name ?? catalogs[0]?.id ?? null;
        const deploy = makeCatalogConfigDeploy({
          store,
          api,
          lockfilePath: options.lockfilePath,
          projectId: options.projectId,
          throttle: options.throttle,
        });
        return { deploy, account } satisfies ConnectedDeploy;
      }),
  });
}
