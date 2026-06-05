import { Data, Effect } from "effect";
import type {
  AuthorConfig,
  BranchConfig,
  CatalogConfig,
  CollectionConfig,
  ItemConfig,
  LoanPolicyConfig,
  ShelfConfig,
} from "./schema";

/**
 * A mock of a library platform's catalog API, as a plain in-memory Effect
 * service. Unlike a "real" backend it stores the *config shapes* directly (no
 * separate wire DTOs), so the deploy providers map 1:1 — entity ids double as
 * remote ids. Every call is recorded on `calls` so tests can assert traffic.
 */
export class CatalogApiError extends Data.TaggedError("CatalogApiError")<{
  readonly group: string;
  readonly operation: string;
  readonly id?: string | undefined;
  readonly message: string;
}> {}

export interface CatalogApiCall {
  readonly group: string;
  readonly operation: string;
  readonly id?: string | undefined;
}

/** Full CRUD over a collection of config records keyed by their `id`. */
export interface CrudApi<T> {
  readonly list: Effect.Effect<readonly T[], CatalogApiError>;
  readonly get: (id: string) => Effect.Effect<T | null, CatalogApiError>;
  readonly create: (record: T) => Effect.Effect<T, CatalogApiError>;
  readonly update: (id: string, record: T) => Effect.Effect<T, CatalogApiError>;
  readonly delete: (id: string) => Effect.Effect<void, CatalogApiError>;
}

export interface CatalogApi {
  /** The catalog container is read-only via config-as-code. */
  readonly catalog: { readonly list: Effect.Effect<readonly CatalogConfig[], CatalogApiError> };
  readonly branches: CrudApi<BranchConfig>;
  readonly authors: CrudApi<AuthorConfig>;
  readonly shelves: CrudApi<ShelfConfig>;
  readonly items: CrudApi<ItemConfig>;
  readonly collections: CrudApi<CollectionConfig>;
  readonly loanPolicies: CrudApi<LoanPolicyConfig>;
  /** Every call made through the mock, in order. */
  readonly calls: CatalogApiCall[];
}

export interface CatalogSeed {
  readonly catalog: CatalogConfig | null;
  readonly branches: readonly BranchConfig[];
  readonly authors: readonly AuthorConfig[];
  readonly shelves: readonly ShelfConfig[];
  readonly items: readonly ItemConfig[];
  readonly collections: readonly CollectionConfig[];
  readonly loanPolicies: readonly LoanPolicyConfig[];
}

export interface MockCatalogApi extends CatalogApi {
  readonly snapshot: Effect.Effect<CatalogSeed>;
}

export interface MockCatalogApiOptions {
  readonly seed: CatalogSeed;
}

export function makeMockCatalogApi(options: MockCatalogApiOptions): MockCatalogApi {
  const seed = options.seed;
  const calls: CatalogApiCall[] = [];
  const record = (group: string, operation: string, id?: string): void => {
    calls.push(id === undefined ? { group, operation } : { group, operation, id });
  };

  const catalogValue = seed.catalog;

  const crud = <T extends { readonly id: string }>(
    group: string,
    initial: readonly T[],
  ): CrudApi<T> => {
    const store = new Map(initial.map((record) => [record.id, record]));
    const missing = (operation: string, id: string) =>
      Effect.fail(
        new CatalogApiError({ group, operation, id, message: `${group} ${id} not found` }),
      );
    return {
      list: Effect.sync(() => {
        record(group, "list");
        return [...store.values()];
      }),
      get: (id) =>
        Effect.sync(() => {
          record(group, "get", id);
          return store.get(id) ?? null;
        }),
      create: (value) =>
        Effect.sync(() => {
          record(group, "create", value.id);
          store.set(value.id, value);
          return value;
        }),
      update: (id, value) =>
        Effect.gen(function* () {
          record(group, "update", id);
          if (!store.has(id)) return yield* missing("update", id);
          store.set(id, value);
          return value;
        }),
      delete: (id) =>
        Effect.gen(function* () {
          record(group, "delete", id);
          if (!store.has(id)) return yield* missing("delete", id);
          store.delete(id);
        }),
    };
  };

  const branches = crud<BranchConfig>("branches", seed.branches);
  const authors = crud<AuthorConfig>("authors", seed.authors);
  const shelves = crud<ShelfConfig>("shelves", seed.shelves);
  const items = crud<ItemConfig>("items", seed.items);
  const collections = crud<CollectionConfig>("collections", seed.collections);
  const loanPolicies = crud<LoanPolicyConfig>("loanPolicies", seed.loanPolicies);

  return {
    calls,
    catalog: {
      list: Effect.sync(() => {
        record("catalog", "list");
        return catalogValue ? [catalogValue] : [];
      }),
    },
    branches,
    authors,
    shelves,
    items,
    collections,
    loanPolicies,
    snapshot: Effect.gen(function* () {
      // The mock's `list` is synchronous and never fails; `orDie` reflects that
      // so the snapshot has no error channel.
      return {
        catalog: catalogValue,
        branches: yield* branches.list.pipe(Effect.orDie),
        authors: yield* authors.list.pipe(Effect.orDie),
        shelves: yield* shelves.list.pipe(Effect.orDie),
        items: yield* items.list.pipe(Effect.orDie),
        collections: yield* collections.list.pipe(Effect.orDie),
        loanPolicies: yield* loanPolicies.list.pipe(Effect.orDie),
      } satisfies CatalogSeed;
    }),
  };
}
