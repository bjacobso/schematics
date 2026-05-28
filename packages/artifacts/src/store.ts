import { Effect, Stream } from "effect";
import type { ArtifactRef } from "./ref";
import { ArtifactRef as Ref } from "./ref";

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
  readonly workspaceId?: string | undefined;
}

export function createMemoryArtifactStore(options: MemoryArtifactStoreOptions = {}): ArtifactStore {
  const entries = new Map<string, ArtifactStoreEntry>();

  for (const file of options.files ?? []) {
    const ref = Ref.workspaceFile(file.path, file.workspaceId);
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
      }),

    create: (ref, content) =>
      Effect.gen(function* () {
        const key = keyForRef(ref);
        if (entries.has(key)) return yield* Effect.fail(storeError("already-exists", ref));
        entries.set(key, { ref, content });
        return ref;
      }),

    delete: (ref) =>
      Effect.gen(function* () {
        const key = keyForRef(ref);
        if (!entries.has(key)) return yield* Effect.fail(storeError("not-found", ref));
        entries.delete(key);
      }),
  };
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
    case "Workspace":
      return `Workspace:${ref.workspaceId ?? ""}`;
    case "WorkspaceFile":
      return `WorkspaceFile:${ref.workspaceId ?? ""}:${ref.path}`;
  }
}
