import { Effect } from "effect";
import type { NormalizedResource, ResourceCrud } from "./resource";

export interface MockApiCall {
  readonly group: string;
  readonly operation: "list" | "get" | "create" | "update" | "delete";
  readonly id?: string | undefined;
}

/**
 * A derived in-memory transport: a `{ [remoteKey]: ResourceCrud }` record backed
 * by a Map per resource (keyed by `dtoKey`), seeded from `seed`/`resource.seed`,
 * recording every call. Stands in for a flavor's live API in tests and the
 * playground demo — no hand-written mock per entity.
 */
export interface DerivedMockTransport {
  readonly api: Record<string, ResourceCrud<any>>;
  readonly calls: MockApiCall[];
  /** Current records per `remoteKey` — for persisting mock state across runs. */
  readonly snapshot: Effect.Effect<Record<string, readonly any[]>>;
}

export interface DeriveMockOptions {
  /** Seed records per `remoteKey`; overrides each resource's own `seed`. */
  readonly seed?: Readonly<Record<string, readonly any[]>> | undefined;
}

export function deriveMockTransport(
  resources: readonly NormalizedResource[],
  options: DeriveMockOptions = {},
): DerivedMockTransport {
  const calls: MockApiCall[] = [];
  const record = (group: string, operation: MockApiCall["operation"], id?: string): void => {
    calls.push(id === undefined ? { group, operation } : { group, operation, id });
  };

  const api: Record<string, ResourceCrud<any>> = {};
  const stores: Record<string, Map<string, any>> = {};

  for (const resource of resources) {
    const group = resource.remoteKey;
    const records = options.seed?.[group] ?? resource.seed ?? [];
    const dtoKey = resource.dtoKey;
    const store = new Map<string, any>(records.map((rec) => [String(rec[dtoKey]), rec]));
    stores[group] = store;
    api[group] = makeMockCrud(group, store, dtoKey, record);
  }

  return {
    api,
    calls,
    snapshot: Effect.sync(() =>
      Object.fromEntries(
        Object.entries(stores).map(([group, store]) => [group, [...store.values()]]),
      ),
    ),
  };
}

function makeMockCrud(
  group: string,
  store: Map<string, any>,
  dtoKey: string,
  record: (group: string, operation: MockApiCall["operation"], id?: string) => void,
): ResourceCrud<any> {
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
        const id = String(value[dtoKey]);
        record(group, "create", id);
        store.set(id, value);
        return value;
      }),
    update: (id, value) =>
      Effect.sync(() => {
        record(group, "update", id);
        store.set(id, value);
        return value;
      }),
    delete: (id) =>
      Effect.sync(() => {
        record(group, "delete", id);
        store.delete(id);
      }),
  };
}
