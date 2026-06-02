import { Effect, Queue, Stream } from "effect";
import type { ArtifactRef } from "./ref";
import { ArtifactRef as Ref } from "./ref";

export type ArtifactContent = string | Uint8Array;

/**
 * An entry's state in a store listing, as an explicit discriminated union.
 *
 * - `Loaded` — content is present (the normal case, and the only state that
 *   carries content for snapshots/changes/patches).
 * - `Pending` — the entry exists (its ref/path is known, e.g. seeded from a
 *   remote list endpoint) but its content has not been hydrated yet. A lazy /
 *   streaming store returns these so the UI can render a skeleton and fetch
 *   content on first access.
 */
export interface LoadedArtifactStoreEntry {
  readonly _tag: "Loaded";
  readonly ref: ArtifactRef;
  readonly content: ArtifactContent;
}

export interface PendingArtifactStoreEntry {
  readonly _tag: "Pending";
  readonly ref: ArtifactRef;
}

export type ArtifactStoreEntry = LoadedArtifactStoreEntry | PendingArtifactStoreEntry;

export const loadedEntry = (ref: ArtifactRef, content: ArtifactContent): LoadedArtifactStoreEntry => ({
  _tag: "Loaded",
  ref,
  content,
});

export const pendingEntry = (ref: ArtifactRef): PendingArtifactStoreEntry => ({ _tag: "Pending", ref });

export const isLoadedEntry = (entry: ArtifactStoreEntry): entry is LoadedArtifactStoreEntry =>
  entry._tag === "Loaded";

export const isPendingEntry = (entry: ArtifactStoreEntry): entry is PendingArtifactStoreEntry =>
  entry._tag === "Pending";

/**
 * Store events. `hydrated` is emitted when a previously `Pending` entry's
 * content arrives (lazy/streaming stores); `created`/`updated`/`deleted` keep
 * their usual meaning.
 */
export interface ArtifactStoreEvent {
  readonly type: "created" | "updated" | "deleted" | "hydrated";
  readonly ref: ArtifactRef;
}

export interface ArtifactStoreError {
  readonly _tag: "ArtifactStoreError";
  readonly reason: "not-found" | "already-exists" | "unsupported-ref";
  readonly ref: ArtifactRef;
}

export interface ArtifactStore {
  readonly list: Effect.Effect<readonly ArtifactRef[]>;
  readonly read: (ref: ArtifactRef) => Effect.Effect<ArtifactContent, ArtifactStoreError>;
  readonly write: (
    ref: ArtifactRef,
    content: ArtifactContent,
  ) => Effect.Effect<void, ArtifactStoreError>;
  readonly create: (
    ref: ArtifactRef,
    content: ArtifactContent,
  ) => Effect.Effect<ArtifactRef, ArtifactStoreError>;
  readonly delete: (ref: ArtifactRef) => Effect.Effect<void, ArtifactStoreError>;
  /**
   * Status-aware listing. Stores that track load state (lazy/streaming) return
   * `Loaded`/`Pending` entries so callers can show skeletons without forcing a
   * fetch. Optional — callers should fall back to `list` when absent.
   */
  readonly entries?: Effect.Effect<readonly ArtifactStoreEntry[], ArtifactStoreError> | undefined;
  readonly watch?: Stream.Stream<ArtifactStoreEvent> | undefined;
}

export interface MemoryArtifactStoreOptions {
  readonly files?: readonly MemoryArtifactStoreFile[] | undefined;
}

export interface MemoryArtifactStoreFile {
  readonly path: string;
  readonly content: ArtifactContent;
  readonly projectId?: string | undefined;
}

export type ArtifactRevisionActor = "user" | "agent" | "system";

export interface ArtifactRevisionMetadata {
  readonly actor: ArtifactRevisionActor;
  readonly label: string;
  readonly turnId?: string | undefined;
  readonly toolCallId?: string | undefined;
  readonly timestamp?: number | undefined;
}

export type ArtifactStoreChange =
  | { readonly type: "write"; readonly ref: ArtifactRef; readonly content: ArtifactContent }
  | { readonly type: "create"; readonly ref: ArtifactRef; readonly content: ArtifactContent }
  | { readonly type: "delete"; readonly ref: ArtifactRef }
  | { readonly type: "replace"; readonly entries: readonly LoadedArtifactStoreEntry[] };

export type ArtifactStorePatch =
  | {
      readonly type: "write";
      readonly ref: ArtifactRef;
      readonly before: ArtifactContent | null;
      readonly after: ArtifactContent;
    }
  | {
      readonly type: "delete";
      readonly ref: ArtifactRef;
      readonly before: ArtifactContent;
    }
  | {
      readonly type: "replace";
      readonly before: readonly LoadedArtifactStoreEntry[];
      readonly after: readonly LoadedArtifactStoreEntry[];
    };

export interface ArtifactRevision {
  readonly id: string;
  readonly parentId: string | null;
  readonly timestamp: number;
  readonly actor: ArtifactRevisionActor;
  readonly label: string;
  readonly turnId?: string | undefined;
  readonly toolCallId?: string | undefined;
  readonly patch: ArtifactStorePatch;
}

export interface ArtifactHistoryState {
  readonly revisions: readonly ArtifactRevision[];
  readonly cursor: number;
  readonly revisionSequence: number;
}

export interface VersionedArtifactStore {
  readonly store: ArtifactStore;
  readonly history: Effect.Effect<ArtifactHistoryState>;
  readonly apply: (
    change: ArtifactStoreChange,
    metadata: ArtifactRevisionMetadata,
  ) => Effect.Effect<ArtifactRevision | null, ArtifactStoreError>;
  readonly undo: () => Effect.Effect<ArtifactRevision | null, ArtifactStoreError>;
  readonly redo: () => Effect.Effect<ArtifactRevision | null, ArtifactStoreError>;
}

export function createMemoryArtifactStore(options: MemoryArtifactStoreOptions = {}): ArtifactStore {
  const records = new Map<string, LoadedArtifactStoreEntry>();
  const subscribers = new Set<(event: ArtifactStoreEvent) => void>();

  for (const file of options.files ?? []) {
    const ref = Ref.projectFile(file.path, file.projectId);
    records.set(keyForRef(ref), loadedEntry(ref, file.content));
  }

  return {
    list: Effect.sync(() => Array.from(records.values(), (entry) => entry.ref)),

    entries: Effect.sync(() => Array.from(records.values()) as readonly ArtifactStoreEntry[]),

    read: (ref) =>
      Effect.gen(function* () {
        const key = keyForRef(ref);
        const entry = records.get(key);
        if (!entry) return yield* Effect.fail(storeError("not-found", ref));
        return entry.content;
      }),

    write: (ref, content) =>
      Effect.gen(function* () {
        const key = keyForRef(ref);
        const entry = records.get(key);
        if (!entry) return yield* Effect.fail(storeError("not-found", ref));
        records.set(key, loadedEntry(entry.ref, content));
        publish(subscribers, { type: "updated", ref: entry.ref });
      }),

    create: (ref, content) =>
      Effect.gen(function* () {
        const key = keyForRef(ref);
        if (records.has(key)) return yield* Effect.fail(storeError("already-exists", ref));
        records.set(key, loadedEntry(ref, content));
        publish(subscribers, { type: "created", ref });
        return ref;
      }),

    delete: (ref) =>
      Effect.gen(function* () {
        const key = keyForRef(ref);
        const entry = records.get(key);
        if (!entry) return yield* Effect.fail(storeError("not-found", ref));
        records.delete(key);
        publish(subscribers, { type: "deleted", ref: entry.ref });
      }),

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

export function createVersionedArtifactStore(store: ArtifactStore): VersionedArtifactStore {
  let state: ArtifactHistoryState = {
    revisions: [],
    cursor: -1,
    revisionSequence: 0,
  };

  const apply = (
    change: ArtifactStoreChange,
    metadata: ArtifactRevisionMetadata,
  ): Effect.Effect<ArtifactRevision | null, ArtifactStoreError> =>
    Effect.gen(function* () {
      const patch = yield* createPatch(store, change);
      if (!patch) return null;
      yield* applyPatch(store, patch);

      const revisions = state.revisions.slice(0, state.cursor + 1);
      const parentId = state.cursor >= 0 ? (state.revisions[state.cursor]?.id ?? null) : null;
      const nextSequence = state.revisionSequence + 1;
      const revision: ArtifactRevision = {
        id: `artifact-rev-${nextSequence}`,
        parentId,
        timestamp: metadata.timestamp ?? Date.now(),
        actor: metadata.actor,
        label: metadata.label,
        turnId: metadata.turnId,
        toolCallId: metadata.toolCallId,
        patch,
      };
      state = {
        revisions: [...revisions, revision],
        cursor: revisions.length,
        revisionSequence: nextSequence,
      };
      return revision;
    });

  const undo = (): Effect.Effect<ArtifactRevision | null, ArtifactStoreError> =>
    Effect.gen(function* () {
      const revision = state.revisions[state.cursor];
      if (!revision) return null;
      yield* applyPatch(store, invertPatch(revision.patch));
      state = { ...state, cursor: state.cursor - 1 };
      return revision;
    });

  const redo = (): Effect.Effect<ArtifactRevision | null, ArtifactStoreError> =>
    Effect.gen(function* () {
      const revision = state.revisions[state.cursor + 1];
      if (!revision) return null;
      yield* applyPatch(store, revision.patch);
      state = { ...state, cursor: state.cursor + 1 };
      return revision;
    });

  return {
    store,
    history: Effect.sync(() => state),
    apply,
    undo,
    redo,
  };
}

function publish(subscribers: Set<(event: ArtifactStoreEvent) => void>, event: ArtifactStoreEvent) {
  for (const subscriber of subscribers) subscriber(event);
}

function createPatch(
  store: ArtifactStore,
  change: ArtifactStoreChange,
): Effect.Effect<ArtifactStorePatch | null, ArtifactStoreError> {
  switch (change.type) {
    case "write":
      return Effect.gen(function* () {
        const before = yield* store.read(change.ref);
        if (contentEquals(before, change.content)) return null;
        return {
          type: "write",
          ref: change.ref,
          before,
          after: change.content,
        } satisfies ArtifactStorePatch;
      });
    case "create":
      return Effect.gen(function* () {
        const exists = yield* store.read(change.ref).pipe(
          Effect.map(() => true),
          Effect.catch((error: ArtifactStoreError) =>
            error.reason === "not-found" ? Effect.succeed(false) : Effect.fail(error),
          ),
        );
        if (exists) return yield* Effect.fail(storeError("already-exists", change.ref));
        return {
          type: "write",
          ref: change.ref,
          before: null,
          after: change.content,
        } satisfies ArtifactStorePatch;
      });
    case "delete":
      return Effect.gen(function* () {
        const before = yield* store.read(change.ref);
        return { type: "delete", ref: change.ref, before } satisfies ArtifactStorePatch;
      });
    case "replace":
      return Effect.gen(function* () {
        const before = yield* readAllEntries(store);
        const after = normalizeEntries(change.entries);
        if (entriesEqual(before, after)) return null;
        return { type: "replace", before, after } satisfies ArtifactStorePatch;
      });
  }
}

function applyPatch(
  store: ArtifactStore,
  patch: ArtifactStorePatch,
): Effect.Effect<void, ArtifactStoreError> {
  switch (patch.type) {
    case "write":
      return patch.before === null
        ? store.create(patch.ref, patch.after).pipe(Effect.asVoid)
        : store.write(patch.ref, patch.after);
    case "delete":
      return store.delete(patch.ref);
    case "replace":
      return replaceEntries(store, patch.after);
  }
}

function invertPatch(patch: ArtifactStorePatch): ArtifactStorePatch {
  switch (patch.type) {
    case "write":
      return patch.before === null
        ? { type: "delete", ref: patch.ref, before: patch.after }
        : { type: "write", ref: patch.ref, before: patch.after, after: patch.before };
    case "delete":
      return { type: "write", ref: patch.ref, before: null, after: patch.before };
    case "replace":
      return { type: "replace", before: patch.after, after: patch.before };
  }
}

function replaceEntries(
  store: ArtifactStore,
  entries: readonly LoadedArtifactStoreEntry[],
): Effect.Effect<void, ArtifactStoreError> {
  return Effect.gen(function* () {
    const current = yield* readAllEntries(store);
    const nextByKey = new Map(
      normalizeEntries(entries).map((entry) => [keyForRef(entry.ref), entry]),
    );

    for (const entry of current) {
      if (!nextByKey.has(keyForRef(entry.ref))) {
        yield* store.delete(entry.ref);
      }
    }

    for (const entry of nextByKey.values()) {
      const currentEntry = current.find(
        (candidate) => keyForRef(candidate.ref) === keyForRef(entry.ref),
      );
      if (currentEntry) {
        if (!contentEquals(currentEntry.content, entry.content)) {
          yield* store.write(currentEntry.ref, entry.content);
        }
      } else {
        yield* store.create(entry.ref, entry.content).pipe(Effect.asVoid);
      }
    }
  });
}

function readAllEntries(
  store: ArtifactStore,
): Effect.Effect<readonly LoadedArtifactStoreEntry[], ArtifactStoreError> {
  return Effect.gen(function* () {
    const refs = yield* store.list;
    const entries: LoadedArtifactStoreEntry[] = [];
    for (const ref of refs) {
      entries.push(loadedEntry(ref, yield* store.read(ref)));
    }
    return normalizeEntries(entries);
  });
}

function normalizeEntries(
  entries: readonly LoadedArtifactStoreEntry[],
): readonly LoadedArtifactStoreEntry[] {
  return [...new Map(entries.map((entry) => [keyForRef(entry.ref), entry])).values()].sort(
    (left, right) => keyForRef(left.ref).localeCompare(keyForRef(right.ref)),
  );
}

function entriesEqual(
  left: readonly LoadedArtifactStoreEntry[],
  right: readonly LoadedArtifactStoreEntry[],
): boolean {
  const normalizedLeft = normalizeEntries(left);
  const normalizedRight = normalizeEntries(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((entry, index) => {
      const other = normalizedRight[index];
      return (
        other !== undefined &&
        keyForRef(entry.ref) === keyForRef(other.ref) &&
        contentEquals(entry.content, other.content)
      );
    })
  );
}

function contentEquals(left: ArtifactContent, right: ArtifactContent): boolean {
  if (typeof left === "string" || typeof right === "string") return left === right;
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function storeError(reason: ArtifactStoreError["reason"], ref: ArtifactRef): ArtifactStoreError {
  return { _tag: "ArtifactStoreError", reason, ref };
}

function keyForRef(ref: ArtifactRef): string {
  switch (ref._tag) {
    case "Path":
      return `Path:${ref.path}`;
    case "Url":
      return `Url:${ref.url}`;
    case "Blob":
      return `Blob:${ref.id}`;
    case "GitBlob":
      return `GitBlob:${ref.repo}:${ref.oid}`;
    case "Project":
      return `Project:${ref.projectId ?? ""}`;
    case "ProjectFile":
      return `ProjectFile:${ref.projectId ?? ""}:${ref.path}`;
  }
}
