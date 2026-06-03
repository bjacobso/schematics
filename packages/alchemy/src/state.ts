import {
  ArtifactRef,
  type ArtifactRef as ArtifactRefValue,
  type ArtifactStore,
  type ArtifactStoreError,
} from "@schema-ide/artifacts";
import { Effect } from "effect";

/**
 * The lockfile. Since the remote has no slug, this is the only place that
 * remembers `kind:slug → remoteId`. `appliedHash` is the wire hash captured at
 * the last successful apply, for cross-session drift checks.
 */
export interface ConfigStateEntry {
  readonly kind: string;
  readonly key: string;
  readonly remoteId: string;
  readonly appliedHash: string;
}

export interface ConfigState {
  readonly entries: readonly ConfigStateEntry[];
}

export const emptyConfigState: ConfigState = { entries: [] };

export interface ConfigStateStore {
  readonly read: Effect.Effect<ConfigState, ArtifactStoreError>;
  readonly write: (state: ConfigState) => Effect.Effect<void, ArtifactStoreError>;
}

/** In-memory state store (tests, ephemeral runs). */
export function memoryConfigStateStore(initial: ConfigState = emptyConfigState): ConfigStateStore {
  let current = initial;
  return {
    read: Effect.sync(() => current),
    write: (state) =>
      Effect.sync(() => {
        current = state;
      }),
  };
}

/**
 * Lockfile persisted as JSON in an {@link ArtifactStore} (default
 * `config.lock.json`). A missing file reads as empty state.
 */
export function artifactConfigStateStore(
  store: ArtifactStore,
  options: { readonly path?: string | undefined; readonly projectId?: string | undefined } = {},
): ConfigStateStore {
  const path = options.path ?? "config.lock.json";
  const ref: ArtifactRefValue = ArtifactRef.projectFile(path, options.projectId);

  return {
    read: store.read(ref).pipe(
      Effect.map((content) => normalize(JSON.parse(asString(content)))),
      Effect.catchIf(
        (error) => error.reason === "not-found",
        () => Effect.succeed(emptyConfigState),
      ),
    ),
    write: (state) => {
      const text = `${JSON.stringify(sorted(state), null, 2)}\n`;
      return store.write(ref, text).pipe(
        Effect.catchIf(
          (error) => error.reason === "not-found",
          () => Effect.asVoid(store.create(ref, text)),
        ),
      );
    },
  };
}

function normalize(value: unknown): ConfigState {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as ConfigState).entries)
  ) {
    return emptyConfigState;
  }
  return sorted(value as ConfigState);
}

function sorted(state: ConfigState): ConfigState {
  const entries = [...state.entries].sort((a, b) =>
    `${a.kind}:${a.key}`.localeCompare(`${b.kind}:${b.key}`),
  );
  return { entries };
}

function asString(content: string | Uint8Array): string {
  return typeof content === "string" ? content : new TextDecoder().decode(content);
}
