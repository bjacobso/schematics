import { Effect, type Schema } from "effect";
import { ProviderError, type ProviderOperation } from "./errors";
import type { ConfigProvider, RemoteEntity, ResourceRef } from "./provider";

export interface FakeSeed<Props> {
  readonly remoteId: string;
  readonly props: Props;
}

export interface FakeProviderOptions<Props> {
  readonly kind: string;
  readonly schema: Schema.Schema<Props>;
  /** Read the slug from a config value. */
  readonly keyOf: (props: Props) => string;
  /** Pin a slug into a value. Defaults to a no-op (slug already in props). */
  readonly applyKey?: ((props: Props, key: string) => Props) | undefined;
  /** Suggest a slug for a discovered remote entity. Defaults to `keyOf(entity.props)`. */
  readonly suggestKey?: ((entity: RemoteEntity<Props>) => string) | undefined;
  readonly pathFor?: ((key: string) => string) | undefined;
  readonly route?: string | undefined;
  readonly dependsOn?: ((props: Props) => readonly ResourceRef[]) | undefined;
  /** Initial remote contents, with explicit opaque ids. */
  readonly seed?: readonly FakeSeed<Props>[] | undefined;
  readonly failOn?: ProviderOperation | undefined;
}

export interface FakeProviderCall {
  readonly operation: ProviderOperation;
  readonly remoteId?: string | undefined;
  readonly key?: string | undefined;
}

/**
 * In-memory {@link ConfigProvider} for the Layer-1 engine tests. `remote` is keyed
 * by opaque id (distinct from the slug, so the lockfile is genuinely exercised);
 * `calls` records every verb. Mutate `remote` between plan and apply to trigger
 * optimistic-concurrency aborts.
 */
export interface FakeProvider<Props> {
  readonly provider: ConfigProvider<Props>;
  readonly remote: Map<string, Props>;
  readonly calls: FakeProviderCall[];
}

export function makeFakeProvider<Props>(options: FakeProviderOptions<Props>): FakeProvider<Props> {
  const remote = new Map<string, Props>();
  const calls: FakeProviderCall[] = [];
  const route = options.route ?? `${options.kind}/*.json`;
  const pathFor = options.pathFor ?? ((key: string) => `${options.kind}/${key}.json`);
  const applyKey = options.applyKey ?? ((props: Props) => props);
  const suggestKey = options.suggestKey ?? ((entity: RemoteEntity<Props>) => options.keyOf(entity.props));

  let counter = 0;
  const nextId = (): string => {
    counter += 1;
    return `${options.kind}-${counter}`;
  };

  for (const seed of options.seed ?? []) {
    remote.set(seed.remoteId, seed.props);
  }

  const fail = (operation: ProviderOperation, key?: string) =>
    new ProviderError({ kind: options.kind, operation, key, message: `fake provider forced failure on ${operation}` });

  const provider: ConfigProvider<Props> = {
    kind: options.kind,
    schema: options.schema,
    keyOf: options.keyOf,
    applyKey,
    suggestKey,
    pathFor,
    route,
    dependsOn: options.dependsOn,
    listSummaries: Effect.gen(function* () {
      calls.push({ operation: "list" });
      if (options.failOn === "list") return yield* fail("list");
      return [...remote.entries()].map(([remoteId, props]) => ({
        remoteId,
        suggestedKey: suggestKey({ remoteId, props }),
      }));
    }),
    list: Effect.gen(function* () {
      calls.push({ operation: "list" });
      if (options.failOn === "list") return yield* fail("list");
      return [...remote.entries()].map(([remoteId, props]) => ({ remoteId, props }));
    }),
    read: (remoteId) =>
      Effect.gen(function* () {
        calls.push({ operation: "read", remoteId });
        if (options.failOn === "read") return yield* fail("read");
        const props = remote.get(remoteId);
        return props === undefined ? null : { remoteId, props };
      }),
    create: (props, _context) =>
      Effect.gen(function* () {
        const key = options.keyOf(props);
        calls.push({ operation: "create", key });
        if (options.failOn === "create") return yield* fail("create", key);
        const remoteId = nextId();
        remote.set(remoteId, props);
        return { remoteId, props };
      }),
    update: (remoteId, props, _context) =>
      Effect.gen(function* () {
        calls.push({ operation: "update", remoteId });
        if (options.failOn === "update") return yield* fail("update");
        remote.set(remoteId, props);
        return { remoteId, props };
      }),
    delete: (remoteId) =>
      Effect.gen(function* () {
        calls.push({ operation: "delete", remoteId });
        if (options.failOn === "delete") return yield* fail("delete");
        remote.delete(remoteId);
      }),
  };

  return { provider, remote, calls };
}
