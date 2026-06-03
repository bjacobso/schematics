import {
  ArtifactRef,
  createMemoryArtifactStore,
  pendingEntry,
  pathFromArtifactRef,
  type ArtifactContent,
  type ArtifactRef as ArtifactRefValue,
  type ArtifactStore,
  type ArtifactStoreEntry,
  type ArtifactStoreError,
  type ArtifactStoreEvent,
} from "@schema-ide/artifacts";
import { Effect, Queue, Result, Schema, SchemaIssue, Stream } from "effect";
import type { ConfigCodec } from "./codec";
import { memoryConfigStateStore, type ConfigStateEntry, type ConfigStateStore } from "./state";
import type { AnyConfigProvider } from "./provider";

export interface HydratingArtifactStoreOptions {
  readonly providers: readonly AnyConfigProvider[];
  readonly codec: ConfigCodec;
  /** Lockfile store (shared with the engine so plan/apply resolve slug↔remoteId). */
  readonly state?: ConfigStateStore | undefined;
  readonly projectId?: string | undefined;
  /** Max concurrent hydrations during `sync`. Default 8. */
  readonly concurrency?: number | undefined;
}

/** Progress events for a streaming sync, as an explicit tagged union. */
export type SyncEvent =
  | { readonly _tag: "listed"; readonly total: number }
  | { readonly _tag: "hydrated"; readonly ref: ArtifactRefValue }
  | { readonly _tag: "failed"; readonly ref: ArtifactRefValue; readonly message: string };

/**
 * A lazy / streaming {@link ArtifactStore} backed by config providers.
 *
 * `seed` pulls the cheap list endpoints and creates **pending** entries (the
 * file-tree skeleton) without content, seeding the lockfile (`slug ↔ remoteId`).
 * Content is fetched on first `read` (de-duplicated, so concurrent reads of the
 * same ref fetch once), and `sync` streams the whole hydration as progress
 * events while the store's `watch` emits `created` (skeleton) then `hydrated`
 * (content) so the UI fills in over time.
 */
export interface HydratingArtifactStore extends ArtifactStore {
  /** Seed the skeleton from list endpoints + lockfile. Returns the pending refs. */
  readonly seed: Effect.Effect<readonly ArtifactRefValue[], ArtifactStoreError>;
  /** Force-hydrate a single ref (same path `read` takes lazily). */
  readonly hydrate: (ref: ArtifactRefValue) => Effect.Effect<ArtifactContent, ArtifactStoreError>;
  /** Seed, then stream hydration of every pending entry as {@link SyncEvent}s. */
  readonly sync: Stream.Stream<SyncEvent, ArtifactStoreError>;
}

interface Descriptor {
  readonly ref: ArtifactRefValue;
  readonly provider: AnyConfigProvider;
  readonly remoteId: string;
  readonly slug: string;
}

const formatIssue = SchemaIssue.makeFormatterDefault();

export function makeHydratingArtifactStore(
  options: HydratingArtifactStoreOptions,
): HydratingArtifactStore {
  const { providers, codec, projectId } = options;
  const state = options.state ?? memoryConfigStateStore();
  const concurrency = options.concurrency ?? 8;

  const cache = createMemoryArtifactStore(); // holds hydrated (loaded) content
  const descriptors = new Map<string, Descriptor>();
  const memos = new Map<string, Effect.Effect<ArtifactContent, ArtifactStoreError>>();
  const subscribers = new Set<(event: ArtifactStoreEvent) => void>();

  const publish = (event: ArtifactStoreEvent): void => {
    for (const subscriber of subscribers) subscriber(event);
  };

  const encode = (provider: AnyConfigProvider, props: unknown): Result.Result<unknown, string> => {
    const encoded = Schema.encodeUnknownResult(provider.schema as never)(props);
    return Result.isFailure(encoded)
      ? Result.fail(formatIssue(encoded.failure))
      : Result.succeed(encoded.success);
  };

  /** The actual fetch for one descriptor — wrapped in Effect.cached so it runs once. */
  const fetchDescriptor = (
    descriptor: Descriptor,
  ): Effect.Effect<ArtifactContent, ArtifactStoreError> =>
    Effect.gen(function* () {
      const entity = yield* descriptor.provider
        .read(descriptor.remoteId)
        .pipe(Effect.mapError(() => storeError("not-found", descriptor.ref)));
      if (entity === null) return yield* Effect.fail(storeError("not-found", descriptor.ref));

      const props = descriptor.provider.applyKey(entity.props, descriptor.slug);
      const wire = encode(descriptor.provider, props);
      if (Result.isFailure(wire))
        return yield* Effect.fail(storeError("not-found", descriptor.ref));
      const text = yield* Effect.try({
        try: () => codec.stringify(wire.success),
        catch: () => storeError("not-found", descriptor.ref),
      });

      yield* cache.create(descriptor.ref, text).pipe(
        Effect.catchIf(
          (error) => error.reason === "already-exists",
          () => Effect.asVoid(cache.write(descriptor.ref, text)),
        ),
      );
      publish({ type: "hydrated", ref: descriptor.ref });
      return text;
    });

  const seed: HydratingArtifactStore["seed"] = Effect.gen(function* () {
    const previous = yield* state.read;
    const refs: ArtifactRefValue[] = [];
    const nextEntries: ConfigStateEntry[] = [...previous.entries];

    for (const provider of providers) {
      const existing = previous.entries.filter((entry) => entry.kind === provider.kind);
      const slugByRemote = new Map(existing.map((entry) => [entry.remoteId, entry.key]));
      const used = new Set(existing.map((entry) => entry.key));

      const summaries = yield* provider.listSummaries.pipe(
        Effect.mapError(() => storeError("unsupported-ref", ArtifactRef.project(projectId))),
      );
      for (const summary of summaries) {
        const slug = slugByRemote.get(summary.remoteId) ?? dedupe(summary.suggestedKey, used);
        used.add(slug);
        const ref = ArtifactRef.projectFile(provider.pathFor(slug), projectId);
        const key = refKey(ref);
        const descriptor: Descriptor = { ref, provider, remoteId: summary.remoteId, slug };
        descriptors.set(key, descriptor);
        memos.set(key, yield* Effect.cached(fetchDescriptor(descriptor)));
        if (!slugByRemote.has(summary.remoteId)) {
          nextEntries.push({
            kind: provider.kind,
            key: slug,
            remoteId: summary.remoteId,
            appliedHash: "",
          });
        }
        refs.push(ref);
        publish({ type: "created", ref });
      }
    }

    yield* state.write({ entries: nextEntries });
    return refs;
  });

  const hydrate: HydratingArtifactStore["hydrate"] = (ref) => {
    const memo = memos.get(refKey(ref));
    return memo ?? Effect.fail(storeError("not-found", ref));
  };

  const sync: HydratingArtifactStore["sync"] = Stream.fromEffect(seed).pipe(
    Stream.flatMap((refs) =>
      Stream.fromIterable<SyncEvent>([{ _tag: "listed", total: refs.length }]).pipe(
        Stream.concat(
          Stream.fromIterable(refs).pipe(
            Stream.mapEffect(
              (ref) =>
                hydrate(ref).pipe(
                  Effect.map((): SyncEvent => ({ _tag: "hydrated", ref })),
                  Effect.catch((error: ArtifactStoreError) =>
                    Effect.succeed<SyncEvent>({ _tag: "failed", ref, message: error.reason }),
                  ),
                ),
              { concurrency },
            ),
          ),
        ),
      ),
    ),
  );

  return {
    seed,
    hydrate,
    sync,

    list: Effect.gen(function* () {
      const loaded = yield* cache.list;
      const byKey = new Map(loaded.map((ref) => [refKey(ref), ref]));
      for (const [key, descriptor] of descriptors) {
        if (!byKey.has(key)) byKey.set(key, descriptor.ref);
      }
      return [...byKey.values()];
    }),

    entries: Effect.gen(function* () {
      const loaded = yield* cache.entries!;
      const loadedKeys = new Set(loaded.map((entry) => refKey(entry.ref)));
      const result: ArtifactStoreEntry[] = [...loaded];
      for (const [key, descriptor] of descriptors) {
        if (!loadedKeys.has(key)) result.push(pendingEntry(descriptor.ref));
      }
      return result;
    }),

    read: (ref) =>
      cache.read(ref).pipe(
        Effect.catchIf(
          (error) => error.reason === "not-found",
          () => hydrate(ref),
        ),
      ),

    write: (ref, content) =>
      cache.write(ref, content).pipe(
        Effect.catchIf(
          (error) => error.reason === "not-found",
          () => Effect.asVoid(cache.create(ref, content)),
        ),
        Effect.tap(() =>
          Effect.sync(() => {
            memos.delete(refKey(ref));
            publish({ type: "updated", ref });
          }),
        ),
      ),

    create: (ref, content) =>
      cache
        .create(ref, content)
        .pipe(Effect.tap(() => Effect.sync(() => publish({ type: "created", ref })))),

    delete: (ref) =>
      cache.delete(ref).pipe(
        Effect.catchIf(
          (error) => error.reason === "not-found",
          () =>
            descriptors.has(refKey(ref)) ? Effect.void : Effect.fail(storeError("not-found", ref)),
        ),
        Effect.tap(() =>
          Effect.sync(() => {
            descriptors.delete(refKey(ref));
            memos.delete(refKey(ref));
            publish({ type: "deleted", ref });
          }),
        ),
      ),

    watch: Stream.callback<ArtifactStoreEvent>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const subscriber = (event: ArtifactStoreEvent) => Queue.offerUnsafe(queue, event);
          subscribers.add(subscriber);
          return subscriber;
        }),
        (subscriber) => Effect.sync(() => subscribers.delete(subscriber)),
      ),
    ),
  };
}

function dedupe(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function refKey(ref: ArtifactRefValue): string {
  return pathFromArtifactRef(ref) ?? `${ref._tag}`;
}

function storeError(
  reason: ArtifactStoreError["reason"],
  ref: ArtifactRefValue,
): ArtifactStoreError {
  return { _tag: "ArtifactStoreError", reason, ref };
}
