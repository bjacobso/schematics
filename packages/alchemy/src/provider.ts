import type { Effect, Schema } from "effect";
import type { ProviderError } from "./errors";

/** A pointer to another managed resource (by slug), used to express apply ordering. */
export interface ResourceRef {
  readonly kind: string;
  readonly key: string;
}

/**
 * Context handed to `create`/`update` during apply. `resolveRemoteId` maps a
 * (kind, slug) to its remote id, reflecting **in-progress** assignments from the
 * current apply plus the lockfile — so an entity created earlier in the same run
 * (a form) is resolvable by an entity applied later (a policy referencing it).
 */
export interface ApplyContext {
  readonly resolveRemoteId: (kind: string, key: string) => string | null;
}

/** A remote entity as returned by the API: an opaque server id plus the config-shaped value. */
export interface RemoteEntity<Props> {
  readonly remoteId: string;
  readonly props: Props;
}

/**
 * A lightweight descriptor from the cheap *list* endpoint — enough to build the
 * file-tree skeleton and seed the lockfile without fetching full content.
 */
export interface RemoteSummary {
  readonly remoteId: string;
  /** Candidate slug for a newly-discovered entity (e.g. slugify its name). */
  readonly suggestedKey: string;
  /** Optional preview (e.g. name/status) for the skeleton UI. */
  readonly summary?: unknown;
}

/**
 * The "cloud" boundary, mirroring Alchemy's resource provider but for a config
 * API. One provider owns one entity kind. Implementations live in Layer 2
 * (the catalog example); the abstract engine only sees this interface.
 *
 * Identity is split: files use a human **slug** (`keyOf`), the remote uses an
 * opaque **remoteId**. The engine's lockfile maps `slug ↔ remoteId` — the only
 * place that mapping lives, since the remote has no slug field.
 *
 * `list` MUST return only entities within the managed scope (e.g. those carrying
 * the reserved config-as-code tag), so apply never touches hand-made config.
 */
export interface ResourceHandler<Props = unknown> {
  readonly kind: string;
  /** Object-level schema for `Props` ⇄ wire (plain JSON). Codec handles text. */
  readonly schema: Schema.Schema<Props>;
  /** Working-tree path a pulled entity is written to (e.g. `forms/<slug>.yaml`). */
  readonly pathFor: (key: string) => string;
  /** Glob matching this provider's files in the working tree (e.g. `forms/*.yaml`). */
  readonly route: string;
  /** Optional dependency edges (by slug), used to topologically order apply/destroy. */
  readonly dependsOn?: ((props: Props) => readonly ResourceRef[]) | undefined;

  /** Read the slug out of a config file's value. */
  readonly keyOf: (props: Props) => string;
  /** Suggest a slug for a newly-discovered remote entity (e.g. slugify its name). */
  readonly suggestKey: (entity: RemoteEntity<Props>) => string;
  /** Pin a resolved slug into a value before it is written to a file. */
  readonly applyKey: (props: Props, key: string) => Props;

  /** Cheap list endpoint: descriptors only (for the skeleton + lockfile seed). */
  readonly listSummaries: Effect.Effect<readonly RemoteSummary[], ProviderError>;
  /** Full list (with content) — used by the eager engine to diff. */
  readonly list: Effect.Effect<readonly RemoteEntity<Props>[], ProviderError>;
  readonly read: (remoteId: string) => Effect.Effect<RemoteEntity<Props> | null, ProviderError>;
  readonly create: (
    props: Props,
    context: ApplyContext,
  ) => Effect.Effect<RemoteEntity<Props>, ProviderError>;
  readonly update: (
    remoteId: string,
    props: Props,
    context: ApplyContext,
    /** The live value at plan time (Alchemy's "olds"); null if unavailable. */
    before?: Props | null,
  ) => Effect.Effect<RemoteEntity<Props>, ProviderError>;
  readonly delete: (remoteId: string) => Effect.Effect<void, ProviderError>;
}

export type AnyResourceHandler = ResourceHandler<any>;
