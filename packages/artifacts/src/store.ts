import { Effect, Queue, Stream } from "effect";
import type { ArtifactRef } from "./ref";
import { artifactRefKey as keyForRef, ArtifactRef as Ref } from "./ref";

export type ArtifactContent = string | Uint8Array;

export interface ArtifactStoreEntry {
  readonly ref: ArtifactRef;
  readonly content: ArtifactContent;
}

export interface ArtifactStoreEvent {
  readonly type: "created" | "updated" | "deleted";
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
  | { readonly type: "replace"; readonly entries: readonly ArtifactStoreEntry[] };

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
      readonly before: readonly ArtifactStoreEntry[];
      readonly after: readonly ArtifactStoreEntry[];
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
  const entries = new Map<string, ArtifactStoreEntry>();
  const subscribers = new Set<(event: ArtifactStoreEvent) => void>();

  for (const file of options.files ?? []) {
    const ref = Ref.projectFile(file.path, file.projectId);
    entries.set(keyForRef(ref), { ref, content: file.content });
  }

  return {
    list: Effect.sync(() => Array.from(entries.values(), (entry) => entry.ref)),

    read: (ref) =>
      Effect.gen(function* () {
        const key = keyForRef(ref);
        const entry = entries.get(key);
        if (!entry) return yield* Effect.fail(storeError("not-found", ref));
        return entry.content;
      }),

    write: (ref, content) =>
      Effect.gen(function* () {
        const key = keyForRef(ref);
        const entry = entries.get(key);
        if (!entry) return yield* Effect.fail(storeError("not-found", ref));
        entries.set(key, { ref: entry.ref, content });
        publish(subscribers, { type: "updated", ref: entry.ref });
      }),

    create: (ref, content) =>
      Effect.gen(function* () {
        const key = keyForRef(ref);
        if (entries.has(key)) return yield* Effect.fail(storeError("already-exists", ref));
        entries.set(key, { ref, content });
        publish(subscribers, { type: "created", ref });
        return ref;
      }),

    delete: (ref) =>
      Effect.gen(function* () {
        const key = keyForRef(ref);
        const entry = entries.get(key);
        if (!entry) return yield* Effect.fail(storeError("not-found", ref));
        entries.delete(key);
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
  entries: readonly ArtifactStoreEntry[],
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
): Effect.Effect<readonly ArtifactStoreEntry[], ArtifactStoreError> {
  return Effect.gen(function* () {
    const refs = yield* store.list;
    const entries: ArtifactStoreEntry[] = [];
    for (const ref of refs) {
      entries.push({ ref, content: yield* store.read(ref) });
    }
    return normalizeEntries(entries);
  });
}

function normalizeEntries(entries: readonly ArtifactStoreEntry[]): readonly ArtifactStoreEntry[] {
  return [...new Map(entries.map((entry) => [keyForRef(entry.ref), entry])).values()].sort(
    (left, right) => keyForRef(left.ref).localeCompare(keyForRef(right.ref)),
  );
}

function entriesEqual(
  left: readonly ArtifactStoreEntry[],
  right: readonly ArtifactStoreEntry[],
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
