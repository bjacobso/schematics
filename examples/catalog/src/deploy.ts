import type { ArtifactStore } from "@schematics/artifacts";
import {
  artifactConfigStateStore,
  defineResource,
  makeConfigDeploy,
  makeRateLimiter,
  throttleProvider,
  ProviderError,
  type ConfigDeploy,
  type ResourceHandler,
  type ProviderOperation,
  type RemoteEntity,
} from "@schematics/alchemy";
import { yamlConfigCodec } from "@schematics/deploy";
import { type Duration, Effect } from "effect";
import { makeMockCatalogApi, type CatalogApi, type CatalogApiError, type CrudApi } from "./api";
import {
  AUTHOR_KIND,
  BRANCH_KIND,
  CATALOG_KIND,
  COLLECTION_KIND,
  ITEM_KIND,
  LOAN_POLICY_KIND,
  SHELF_KIND,
  AuthorConfigSchema,
  BranchConfigSchema,
  CatalogConfigSchema,
  CollectionConfigSchema,
  ItemConfigSchema,
  LoanPolicyConfigSchema,
  ShelfConfigSchema,
  type AuthorConfig,
  type BranchConfig,
  type CatalogConfig,
  type CollectionConfig,
  type ItemConfig,
  type LoanPolicyConfig,
  type ShelfConfig,
} from "./schema";

/**
 * Wires the catalog entity providers into the alchemy engine, backed by a
 * {@link CatalogApi}. Because the mock stores config shapes directly, ids double
 * as remote ids and there's no slug↔uid resolver to thread through — each
 * provider is a thin map over the API's CRUD. The single `catalog` container is
 * read-only via config-as-code.
 */
const mapApiError =
  (kind: string, operation: ProviderOperation, key?: string) =>
  (error: CatalogApiError): ProviderError =>
    new ProviderError({ kind, operation, key, message: error.message });

const readOnly = (kind: string, operation: ProviderOperation) =>
  new ProviderError({ kind, operation, message: `${kind} is read-only via config-as-code` });

/**
 * Standard CRUD provider for an id-keyed config record stored in `dir/*.yaml`.
 * The file key *is* the entity id (already a clean slug), so the engine never
 * re-keys an entity and id-based cross-references stay valid — no slug↔id
 * resolver needed.
 */
function crudProvider<T extends { readonly id: string }>(options: {
  readonly kind: string;
  readonly schema: ResourceHandler<T>["schema"];
  readonly dir: string;
  readonly api: CrudApi<T>;
}): ResourceHandler<T> {
  const { kind, api } = options;
  const entity = (props: T): RemoteEntity<T> => ({ remoteId: props.id, props });
  return defineResource<T>({
    kind,
    schema: options.schema,
    route: `${options.dir}/*.yaml`,
    path: (key) => `${options.dir}/${key}.yaml`,
    keyField: "id",
    list: api.list.pipe(
      Effect.map((records) => records.map(entity)),
      Effect.mapError(mapApiError(kind, "list")),
    ),
    read: (id) =>
      api.get(id).pipe(
        Effect.map((record) => (record ? entity(record) : null)),
        Effect.mapError(mapApiError(kind, "read", id)),
      ),
    reconcile: ({ news, remoteId }) =>
      (remoteId === null ? api.create(news) : api.update(remoteId, news)).pipe(
        Effect.map(entity),
        Effect.mapError(mapApiError(kind, remoteId === null ? "create" : "update", news.id)),
      ),
    remove: (id) => api.delete(id).pipe(Effect.mapError(mapApiError(kind, "delete", id))),
  });
}

/** Read-only provider for the single catalog container (`catalog.yaml`). */
function catalogProvider(api: CatalogApi): ResourceHandler<CatalogConfig> {
  const entity = (props: CatalogConfig): RemoteEntity<CatalogConfig> => ({
    remoteId: props.id,
    props,
  });
  return defineResource<CatalogConfig>({
    kind: CATALOG_KIND,
    schema: CatalogConfigSchema,
    route: "catalog.yaml",
    path: () => "catalog.yaml",
    keyField: "id",
    list: api.catalog.list.pipe(
      Effect.map((records) => records.map(entity)),
      Effect.mapError(mapApiError(CATALOG_KIND, "list")),
    ),
    read: (id) =>
      api.catalog.list.pipe(
        Effect.map((records) => {
          const found = records.find((c) => c.id === id);
          return found ? entity(found) : null;
        }),
        Effect.mapError(mapApiError(CATALOG_KIND, "read", id)),
      ),
    reconcile: ({ remoteId }) =>
      Effect.fail(readOnly(CATALOG_KIND, remoteId === null ? "create" : "update")),
    remove: () => Effect.void,
  });
}

export interface CatalogConfigDeployOptions {
  readonly store: ArtifactStore;
  /** Defaults to a fresh in-memory mock CatalogApi seeded with the NYC fixture. */
  readonly api?: CatalogApi | undefined;
  readonly lockfilePath?: string | undefined;
  readonly projectId?: string | undefined;
  /**
   * Global API throttle shared across pull and push. When set, one serial
   * min-spacing limiter wraps every provider call so the UI fills in over time.
   * Omit to disable; pass `{}` for one call per second.
   */
  readonly throttle?: { readonly interval?: Duration.Input } | undefined;
}

/** The resource kinds this example manages, in dependency-friendly order. */
export const CATALOG_KINDS = [
  CATALOG_KIND,
  BRANCH_KIND,
  AUTHOR_KIND,
  SHELF_KIND,
  ITEM_KIND,
  COLLECTION_KIND,
  LOAN_POLICY_KIND,
] as const;

/** Wire all catalog providers into the engine with the YAML codec + committed lockfile. */
export function makeCatalogConfigDeploy(options: CatalogConfigDeployOptions): ConfigDeploy {
  const api = options.api ?? makeMockCatalogApi({ seed: emptySeed });
  const state = artifactConfigStateStore(options.store, {
    path: options.lockfilePath ?? "config.lock.json",
    projectId: options.projectId,
  });
  const limiter = options.throttle
    ? makeRateLimiter({ interval: options.throttle.interval ?? "1 second" })
    : null;
  const rawProviders: ResourceHandler<any>[] = [
    catalogProvider(api),
    crudProvider<BranchConfig>({
      kind: BRANCH_KIND,
      schema: BranchConfigSchema,
      dir: "branches",
      api: api.branches,
    }),
    crudProvider<AuthorConfig>({
      kind: AUTHOR_KIND,
      schema: AuthorConfigSchema,
      dir: "authors",
      api: api.authors,
    }),
    crudProvider<ShelfConfig>({
      kind: SHELF_KIND,
      schema: ShelfConfigSchema,
      dir: "shelves",
      api: api.shelves,
    }),
    crudProvider<ItemConfig>({
      kind: ITEM_KIND,
      schema: ItemConfigSchema,
      dir: "items",
      api: api.items,
    }),
    crudProvider<CollectionConfig>({
      kind: COLLECTION_KIND,
      schema: CollectionConfigSchema,
      dir: "collections",
      api: api.collections,
    }),
    crudProvider<LoanPolicyConfig>({
      kind: LOAN_POLICY_KIND,
      schema: LoanPolicyConfigSchema,
      dir: "policies",
      api: api.loanPolicies,
    }),
  ];
  const providers = rawProviders.map((provider) =>
    limiter ? throttleProvider(provider, limiter) : provider,
  );
  return makeConfigDeploy({
    store: options.store,
    providers,
    codec: yamlConfigCodec,
    state,
    projectId: options.projectId,
  });
}

const emptySeed = {
  catalog: null,
  branches: [],
  authors: [],
  shelves: [],
  items: [],
  collections: [],
  loanPolicies: [],
} as const;
