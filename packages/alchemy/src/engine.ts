import {
  ArtifactRef,
  matchGlob,
  pathFromArtifactRef,
  type ArtifactRef as ArtifactRefValue,
  type ArtifactStore,
  type ArtifactStoreError,
} from "@schematics/artifacts";
import { validateRelations } from "@schematics/algebra";
import { Effect, Result, Schema, SchemaIssue } from "effect";
import type { ConfigCodec } from "./codec";
import {
  ConfigCodecError,
  ConfigValidationError,
  ProviderError,
  type ConfigValidationIssue,
} from "./errors";
import { diffValues, hashValue, valuesEqual } from "./diff";
import { orderForApply } from "./order";
import { summarize, type ChangeAction, type ConfigPlan, type ResourceChange } from "./plan";
import type { AnyResourceHandler, ApplyContext } from "./provider";
import {
  artifactConfigStateStore,
  memoryConfigStateStore,
  type ConfigState,
  type ConfigStateEntry,
  type ConfigStateStore,
} from "./state";

export interface ConfigDeployOptions {
  readonly store: ArtifactStore;
  readonly providers: readonly AnyResourceHandler[];
  readonly codec: ConfigCodec;
  /** Lockfile store. Defaults to an in-memory store; pass `artifactConfigStateStore(store)` to persist. */
  readonly state?: ConfigStateStore | undefined;
  /** Optional project id scoping the working-tree refs. */
  readonly projectId?: string | undefined;
}

export interface PullResult {
  readonly pulled: readonly {
    readonly kind: string;
    readonly key: string;
    readonly path: string;
  }[];
}

/**
 * Incremental progress emitted during a streaming pull: the file-tree skeleton
 * appears (`listed`/`seeded`) before content is fetched, then each file fills in
 * (`hydrated`) or fails. Mirrors {@link ApplyEvent}'s sink-driven shape.
 */
export type PullEvent =
  | { readonly type: "listed"; readonly total: number }
  | { readonly type: "seeded"; readonly path: string }
  | { readonly type: "hydrated"; readonly path: string }
  | { readonly type: "failed"; readonly path: string; readonly message: string };

export interface PullOptions {
  /**
   * Observe pull progress as it happens: skeleton files are written and
   * `seeded` first, then each file is `hydrated` with content. Sink errors are
   * swallowed so progress reporting can never fail the pull.
   */
  readonly onEvent?: ((event: PullEvent) => Effect.Effect<void>) | undefined;
}

/** Incremental progress emitted as each change reaches a terminal outcome during apply. */
export type ApplyEvent =
  | { readonly type: "applied"; readonly change: ResourceChange }
  | { readonly type: "aborted"; readonly change: ResourceChange; readonly reason: "remote-changed" }
  | { readonly type: "skipped"; readonly change: ResourceChange };

export interface ApplyOptions {
  /** Permit deletes (slug in lock but absent from files). Default false. */
  readonly allowDelete?: boolean | undefined;
  /**
   * Observe each change as it resolves, making apply observably incremental
   * rather than only returning a final {@link ApplyResult}. Errors from the
   * sink are ignored so progress reporting can never fail the apply.
   */
  readonly onEvent?: ((event: ApplyEvent) => Effect.Effect<void>) | undefined;
}

export interface AppliedChange {
  readonly change: ResourceChange;
}

export interface AbortedChange {
  readonly change: ResourceChange;
  readonly reason: "remote-changed";
}

export interface ApplyResult {
  readonly applied: readonly AppliedChange[];
  readonly aborted: readonly AbortedChange[];
  readonly skipped: readonly ResourceChange[];
}

type EngineError = ProviderError | ConfigCodecError | ArtifactStoreError | ConfigValidationError;

interface Entry {
  readonly path: string;
  readonly props: unknown;
  readonly wire: unknown;
}

interface PullDescriptor {
  readonly provider: AnyResourceHandler;
  readonly remoteId: string;
  readonly slug: string;
  readonly path: string;
}

export interface ConfigDeploy {
  /** Hydrate the working tree from the remote and (re)seed the lockfile. */
  readonly pull: Effect.Effect<PullResult, EngineError>;
  /** Same as {@link pull}, but observably streaming via {@link PullOptions.onEvent}. */
  readonly pullWith: (options?: PullOptions) => Effect.Effect<PullResult, EngineError>;
  /** Diff desired files against live remote via the lockfile. Fails on invalid files before any provider call. */
  readonly plan: Effect.Effect<ConfigPlan, EngineError>;
  /** Execute a plan in dependency order; updates the lockfile. */
  readonly apply: (
    plan: ConfigPlan,
    options?: ApplyOptions,
  ) => Effect.Effect<ApplyResult, EngineError>;
  /** Delete everything the lockfile owns (reverse dependency order). */
  readonly destroy: Effect.Effect<ApplyResult, EngineError>;
}

const formatIssue = SchemaIssue.makeFormatterDefault();

export function makeConfigDeploy(options: ConfigDeployOptions): ConfigDeploy {
  const { store, providers, codec, projectId } = options;
  const state = options.state ?? memoryConfigStateStore();
  const providerByKind = new Map<string, AnyResourceHandler>(
    providers.map((provider) => [provider.kind, provider]),
  );
  const refFor = (path: string): ArtifactRefValue => ArtifactRef.projectFile(path, projectId);

  // ── encode/decode helpers (schema ⇄ wire) ──────────────────────────────────

  const decodeWire = (
    provider: AnyResourceHandler,
    wire: unknown,
  ): Result.Result<unknown, string> => {
    const decoded = Schema.decodeUnknownResult(provider.schema as never)(wire);
    return Result.isFailure(decoded)
      ? Result.fail(formatIssue(decoded.failure))
      : Result.succeed(decoded.success);
  };

  const encodeWire = (
    provider: AnyResourceHandler,
    props: unknown,
  ): Result.Result<unknown, string> => {
    const encoded = Schema.encodeUnknownResult(provider.schema as never)(props);
    return Result.isFailure(encoded)
      ? Result.fail(formatIssue(encoded.failure))
      : Result.succeed(encoded.success);
  };

  /** Encode props to wire, failing as a ProviderError (live/applied values should always encode). */
  const encodeOrFail = (
    provider: AnyResourceHandler,
    props: unknown,
    operation: "list" | "read" | "create" | "update",
  ) =>
    Effect.gen(function* () {
      const encoded = encodeWire(provider, props);
      if (Result.isFailure(encoded)) {
        return yield* new ProviderError({
          kind: provider.kind,
          operation,
          message: `Value failed to encode: ${encoded.failure}`,
        });
      }
      return encoded.success;
    });

  const entriesForKind = (configState: ConfigState, kind: string): readonly ConfigStateEntry[] =>
    configState.entries.filter((entry) => entry.kind === kind);

  // ── pull ────────────────────────────────────────────────────────────────────

  const emitPull =
    (options: PullOptions | undefined) =>
    (event: PullEvent): Effect.Effect<void> =>
      options?.onEvent ? Effect.catchCause(options.onEvent(event), () => Effect.void) : Effect.void;

  const runPull = (options?: PullOptions): Effect.Effect<PullResult, EngineError> =>
    Effect.gen(function* () {
      const emit = emitPull(options);
      const previous = yield* state.read;
      // Lockfile entries for kinds we don't own here are carried through untouched.
      const carried = previous.entries.filter(
        (entry) => !providers.some((provider) => provider.kind === entry.kind),
      );

      // Phase A — seed: list cheap summaries, write a skeleton (empty) file per
      // entity, and seed the lockfile (slug↔remoteId) for *every* kind before any
      // content is read, so read-side resolvers (e.g. policy → form slug) see all
      // entries. The UI shows files pop into the tree here, still "loading".
      const descriptors: PullDescriptor[] = [];
      const seeded: ConfigStateEntry[] = [];
      for (const provider of providers) {
        const existing = entriesForKind(previous, provider.kind);
        const slugByRemote = new Map(existing.map((entry) => [entry.remoteId, entry.key]));
        const used = new Set(existing.map((entry) => entry.key));

        const summaries = yield* provider.listSummaries;
        for (const summary of summaries) {
          const slug = slugByRemote.get(summary.remoteId) ?? dedupe(summary.suggestedKey, used);
          used.add(slug);
          const path = provider.pathFor(slug);
          yield* writeOrCreate(store, refFor(path), "");
          descriptors.push({ provider, remoteId: summary.remoteId, slug, path });
          seeded.push({
            kind: provider.kind,
            key: slug,
            remoteId: summary.remoteId,
            appliedHash: "",
          });
        }
      }
      // Persist the fully-seeded lockfile so phase-B reads resolve cross-refs.
      yield* state.write({ entries: [...carried, ...seeded] });
      yield* emit({ type: "listed", total: descriptors.length });
      for (const descriptor of descriptors) yield* emit({ type: "seeded", path: descriptor.path });

      // Phase B — hydrate: read each resource (throttled by the wrapped provider),
      // encode, and fill in the file content; record the applied hash. Each file
      // transitions loading → populated as it is `hydrated`.
      const pulled: { kind: string; key: string; path: string }[] = [];
      const hashByLockKey = new Map<string, string>();
      for (const { provider, remoteId, slug, path } of descriptors) {
        const entity = yield* provider.read(remoteId);
        if (entity === null) {
          yield* emit({ type: "failed", path, message: "not-found" });
          continue;
        }
        const propsWithKey = provider.applyKey(entity.props, slug);
        const wire = yield* encodeOrFail(provider, propsWithKey, "read");
        const text = yield* stringify(codec, path, wire);
        yield* writeOrCreate(store, refFor(path), text);
        hashByLockKey.set(`${provider.kind}:${slug}`, hashValue(wire));
        pulled.push({ kind: provider.kind, key: slug, path });
        yield* emit({ type: "hydrated", path });
      }

      // Re-write the lockfile now that content (and applied hashes) are known.
      yield* state.write({
        entries: [
          ...carried,
          ...seeded.map((entry) => ({
            ...entry,
            appliedHash: hashByLockKey.get(`${entry.kind}:${entry.key}`) ?? entry.appliedHash,
          })),
        ],
      });

      return { pulled };
    });

  const pull: ConfigDeploy["pull"] = runPull();
  const pullWith: ConfigDeploy["pullWith"] = (options) => runPull(options);

  // ── plan ──────────────────────────────────────────────────────────────────

  const plan: ConfigDeploy["plan"] = Effect.gen(function* () {
    const configState = yield* state.read;

    // Phase 1 — decode + validate all desired files. No provider calls yet.
    const refs = yield* store.list;
    const desiredByKind = new Map<string, Map<string, Entry>>();
    const issues: ConfigValidationIssue[] = [];
    for (const provider of providers) desiredByKind.set(provider.kind, new Map());

    for (const ref of refs) {
      const path = pathFromArtifactRef(ref);
      if (path === null) continue;
      const provider = providers.find((candidate) => matchGlob(candidate.route, path));
      if (!provider) continue;

      const text = yield* store.read(ref);
      const parsed = yield* parse(codec, path, asString(text));
      const decoded = decodeWire(provider, parsed);
      if (Result.isFailure(decoded)) {
        issues.push({ kind: provider.kind, path, message: decoded.failure });
        continue;
      }
      const props = decoded.success;
      const wire = encodeWire(provider, props);
      if (Result.isFailure(wire)) {
        issues.push({ kind: provider.kind, path, message: wire.failure });
        continue;
      }
      desiredByKind.get(provider.kind)?.set(provider.keyOf(props), {
        path,
        props,
        wire: wire.success,
      });
    }

    if (issues.length > 0) return yield* new ConfigValidationError({ issues });

    const relationIssues = validateDesiredRelations(providers, configState, desiredByKind);
    if (relationIssues.length > 0) {
      return yield* new ConfigValidationError({ issues: relationIssues });
    }

    // Phase 2 — fetch live, resolve slug↔remoteId via the lockfile, and diff.
    const changes: ResourceChange[] = [];
    for (const provider of providers) {
      const desired = desiredByKind.get(provider.kind) ?? new Map<string, Entry>();
      const lockEntries = entriesForKind(configState, provider.kind);
      const remoteIdBySlug = new Map(lockEntries.map((entry) => [entry.key, entry.remoteId]));

      const live = yield* provider.list;
      const liveByRemote = new Map(live.map((entity) => [entity.remoteId, entity]));

      // creates + updates from desired files
      for (const [slug, want] of desired) {
        const path = provider.pathFor(slug);
        const remoteId = remoteIdBySlug.get(slug) ?? null;
        const liveEntity = remoteId ? liveByRemote.get(remoteId) : undefined;

        if (!liveEntity) {
          // unknown slug, or lock points at a now-deleted remote → (re)create
          changes.push(
            mkChange(
              provider.kind,
              slug,
              null,
              path,
              "create",
              null,
              want.props,
              diffValues(undefined, want.wire),
              null,
            ),
          );
          continue;
        }
        const liveProps = provider.applyKey(liveEntity.props, slug);
        const liveWire = yield* encodeOrFail(provider, liveProps, "list");
        const action: ChangeAction = valuesEqual(liveWire, want.wire) ? "noop" : "update";
        changes.push(
          mkChange(
            provider.kind,
            slug,
            liveEntity.remoteId,
            path,
            action,
            liveProps,
            want.props,
            action === "update" ? diffValues(liveWire, want.wire) : [],
            hashValue(liveWire),
          ),
        );
      }

      // deletes: managed slugs (in lock) that vanished from files and still exist remotely
      for (const entry of lockEntries) {
        if (desired.has(entry.key)) continue;
        const liveEntity = liveByRemote.get(entry.remoteId);
        if (!liveEntity) continue; // already gone remotely
        const liveProps = provider.applyKey(liveEntity.props, entry.key);
        const liveWire = yield* encodeOrFail(provider, liveProps, "list");
        changes.push(
          mkChange(
            provider.kind,
            entry.key,
            entry.remoteId,
            provider.pathFor(entry.key),
            "delete",
            liveProps,
            null,
            diffValues(liveWire, undefined),
            hashValue(liveWire),
          ),
        );
      }
    }

    return { changes, summary: summarize(changes) };
  });

  // ── apply ─────────────────────────────────────────────────────────────────

  const apply: ConfigDeploy["apply"] = (configPlan, applyOptions) =>
    Effect.gen(function* () {
      const allowDelete = applyOptions?.allowDelete ?? false;
      const emit = (event: ApplyEvent): Effect.Effect<void> =>
        applyOptions?.onEvent
          ? Effect.catchCause(applyOptions.onEvent(event), () => Effect.void)
          : Effect.void;
      const configState = yield* state.read;
      const entries = new Map(
        configState.entries.map((entry) => [`${entry.kind}:${entry.key}`, entry]),
      );
      const context: ApplyContext = {
        resolveRemoteId: (kind, key) => entries.get(`${kind}:${key}`)?.remoteId ?? null,
      };
      const ordered = orderForApply(configPlan.changes, providerByKind);
      const applied: AppliedChange[] = [];
      const aborted: AbortedChange[] = [];
      const skipped: ResourceChange[] = [];
      const skip = function* (change: ResourceChange) {
        skipped.push(change);
        yield* emit({ type: "skipped", change });
      };

      for (const change of ordered) {
        if (change.action === "noop") {
          yield* skip(change);
          continue;
        }
        if (change.action === "delete" && !allowDelete) {
          yield* skip(change);
          continue;
        }
        const provider = providerByKind.get(change.kind);
        if (!provider) {
          yield* skip(change);
          continue;
        }

        // Optimistic concurrency: re-read by remote id, compare to the plan-time hash.
        if ((change.action === "update" || change.action === "delete") && change.remoteId) {
          const current = yield* provider.read(change.remoteId);
          const currentHash =
            current === null
              ? null
              : hashValue(
                  yield* encodeOrFail(
                    provider,
                    provider.applyKey(current.props, change.key),
                    "read",
                  ),
                );
          if (currentHash !== change.liveHash) {
            aborted.push({ change, reason: "remote-changed" });
            yield* emit({ type: "aborted", change, reason: "remote-changed" });
            continue;
          }
        }

        const lockKey = `${change.kind}:${change.key}`;
        switch (change.action) {
          case "create": {
            const entity = yield* provider.create(change.after, context);
            const wire = yield* encodeOrFail(
              provider,
              provider.applyKey(entity.props, change.key),
              "create",
            );
            entries.set(lockKey, {
              kind: change.kind,
              key: change.key,
              remoteId: entity.remoteId,
              appliedHash: hashValue(wire),
            });
            break;
          }
          case "update": {
            if (!change.remoteId) {
              yield* skip(change);
              continue;
            }
            const entity = yield* provider.update(
              change.remoteId,
              change.after,
              context,
              change.before,
            );
            const wire = yield* encodeOrFail(
              provider,
              provider.applyKey(entity.props, change.key),
              "update",
            );
            entries.set(lockKey, {
              kind: change.kind,
              key: change.key,
              remoteId: entity.remoteId,
              appliedHash: hashValue(wire),
            });
            break;
          }
          case "delete": {
            if (change.remoteId) yield* provider.delete(change.remoteId);
            entries.delete(lockKey);
            break;
          }
        }
        applied.push({ change });
        yield* emit({ type: "applied", change });
      }

      yield* state.write({ entries: [...entries.values()] });
      return { applied, aborted, skipped };
    });

  // ── destroy ─────────────────────────────────────────────────────────────────

  const destroy: ConfigDeploy["destroy"] = Effect.gen(function* () {
    const configState = yield* state.read;
    const changes: ResourceChange[] = [];
    for (const provider of providers) {
      const lockEntries = entriesForKind(configState, provider.kind);
      const live = yield* provider.list;
      const liveByRemote = new Map(live.map((entity) => [entity.remoteId, entity]));
      for (const entry of lockEntries) {
        const liveEntity = liveByRemote.get(entry.remoteId);
        if (!liveEntity) continue;
        const liveProps = provider.applyKey(liveEntity.props, entry.key);
        const liveWire = yield* encodeOrFail(provider, liveProps, "list");
        changes.push(
          mkChange(
            provider.kind,
            entry.key,
            entry.remoteId,
            provider.pathFor(entry.key),
            "delete",
            liveProps,
            null,
            [],
            hashValue(liveWire),
          ),
        );
      }
    }
    return yield* apply({ changes, summary: summarize(changes) }, { allowDelete: true });
  });

  return { pull, pullWith, plan, apply, destroy };
}

export { artifactConfigStateStore, memoryConfigStateStore };

// ── small helpers ─────────────────────────────────────────────────────────────

function validateDesiredRelations(
  providers: readonly AnyResourceHandler[],
  configState: ConfigState,
  desiredByKind: ReadonlyMap<string, ReadonlyMap<string, Entry>>,
): readonly ConfigValidationIssue[] {
  const fields: Record<string, Schema.Schema<readonly unknown[]>> = {};
  const value: Record<string, unknown[]> = {};
  const sourcePaths = new Map<string, string>();

  for (const provider of providers) {
    fields[provider.kind] = Schema.Array(provider.schema as Schema.Schema<unknown>);
    const desired = desiredByKind.get(provider.kind) ?? new Map<string, Entry>();
    const items: unknown[] = [];

    for (const entry of desired.values()) {
      sourcePaths.set(sourcePathKey(provider.kind, items.length), entry.path);
      items.push(entry.props);
    }

    for (const entry of configState.entries.filter(
      (candidate) => candidate.kind === provider.kind,
    )) {
      if (desired.has(entry.key)) continue;
      sourcePaths.set(sourcePathKey(provider.kind, items.length), provider.pathFor(entry.key));
      items.push(provider.applyKey({} as never, entry.key));
    }

    value[provider.kind] = items;
  }

  const schema = Schema.Struct(fields);
  return validateRelations(schema, value)
    .filter((diagnostic) => diagnostic.code === "unresolved-ref")
    .map((diagnostic) => {
      const kind = diagnostic.path[0] ?? "relations";
      const index = diagnostic.path[1] ?? "0";
      const path =
        typeof kind === "string"
          ? (sourcePaths.get(sourcePathKey(kind, Number(index))) ?? kind)
          : "relations";
      const suffix = diagnostic.path.slice(2).join(".");
      return {
        kind,
        path,
        message: suffix ? `${diagnostic.message} at ${suffix}` : diagnostic.message,
      };
    });
}

function sourcePathKey(kind: string, index: number): string {
  return `${kind}:${index}`;
}

function mkChange(
  kind: string,
  key: string,
  remoteId: string | null,
  path: string,
  action: ChangeAction,
  before: unknown,
  after: unknown,
  fields: ResourceChange["fields"],
  liveHash: string | null,
): ResourceChange {
  return { kind, key, remoteId, path, action, before, after, fields, liveHash };
}

function dedupe(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function asString(content: string | Uint8Array): string {
  return typeof content === "string" ? content : new TextDecoder().decode(content);
}

function parse(
  codec: ConfigCodec,
  path: string,
  text: string,
): Effect.Effect<unknown, ConfigCodecError> {
  return Effect.try({
    try: () => codec.parse(text),
    catch: (cause) => new ConfigCodecError({ path, operation: "parse", message: String(cause) }),
  });
}

function stringify(
  codec: ConfigCodec,
  path: string,
  value: unknown,
): Effect.Effect<string, ConfigCodecError> {
  return Effect.try({
    try: () => codec.stringify(value),
    catch: (cause) =>
      new ConfigCodecError({ path, operation: "stringify", message: String(cause) }),
  });
}

function writeOrCreate(
  store: ArtifactStore,
  ref: ArtifactRefValue,
  text: string,
): Effect.Effect<void, ArtifactStoreError> {
  return store.write(ref, text).pipe(
    Effect.catchIf(
      (error) => error.reason === "not-found",
      () => Effect.asVoid(store.create(ref, text)),
    ),
  );
}
