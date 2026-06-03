import { Effect } from "effect";
import type { ArtifactCachePolicy } from "./policy";
import { artifactRefKey, type ArtifactRef } from "./ref";

/**
 * A view-result cache. Implementations decide where results live (an in-memory
 * map, a Durable Object key/value store, etc.); the registry only needs to
 * read and write by string key. Values stored are *post-decode* view outputs,
 * so a cache hit skips both the handler run and output validation.
 */
export interface ArtifactCacheLookup {
  readonly hit: boolean;
  readonly value: unknown;
}

export interface ArtifactCache {
  readonly lookup: (key: string) => Effect.Effect<ArtifactCacheLookup>;
  readonly store: (key: string, value: unknown) => Effect.Effect<void>;
  readonly invalidate?: ((key: string) => Effect.Effect<void>) | undefined;
  readonly clear?: Effect.Effect<void> | undefined;
}

/**
 * Resolves the content hash for a ref, used by `contentHash` cache policy.
 * Returns `null` when the ref's content can't be hashed cheaply (e.g. a
 * Project ref that spans every file) — the registry then skips caching rather
 * than risk a stale or unbounded key.
 */
export type ArtifactContentHashResolver = (ref: ArtifactRef) => Effect.Effect<string | null>;

export interface ArtifactCacheConfig {
  readonly cache: ArtifactCache;
  readonly resolveContentHash?: ArtifactContentHashResolver | undefined;
  readonly sessionId?: string | undefined;
}

export interface MemoryArtifactCacheOptions {
  /** Maximum entries retained; least-recently-stored are evicted. */
  readonly maxEntries?: number | undefined;
}

/**
 * A bounded in-memory cache with simple insertion-order (LRU-on-write)
 * eviction. Suitable as a per-runtime default or as a shared cache passed
 * across runtime instances so `contentHash` hits survive between requests.
 */
export function createMemoryArtifactCache(options: MemoryArtifactCacheOptions = {}): ArtifactCache {
  const maxEntries = options.maxEntries ?? 256;
  const entries = new Map<string, unknown>();

  return {
    lookup: (key) =>
      Effect.sync(() =>
        entries.has(key)
          ? { hit: true, value: entries.get(key) }
          : { hit: false, value: undefined },
      ),
    store: (key, value) =>
      Effect.sync(() => {
        // Refresh insertion order so repeated writes keep the entry warm.
        if (entries.has(key)) entries.delete(key);
        entries.set(key, value);
        while (entries.size > maxEntries) {
          const oldest = entries.keys().next().value;
          if (oldest === undefined) break;
          entries.delete(oldest);
        }
      }),
    invalidate: (key) =>
      Effect.sync(() => {
        entries.delete(key);
      }),
    clear: Effect.sync(() => {
      entries.clear();
    }),
  };
}

/**
 * Stable, non-cryptographic content hash (FNV-1a, 32-bit, hex). Good enough to
 * key a cache on file content; collisions are astronomically unlikely for the
 * sizes we deal with and a collision only means a stale recompute, never
 * corruption.
 */
export function hashArtifactContent(content: string | Uint8Array): string {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index]!;
    // hash *= 16777619, kept in 32-bit space via the >>> 0 below.
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Content-addressed refs are immutable: their identity *is* their content, so
 * a `ref` or `session` cache keyed on them can never go stale. Mutable refs
 * (a workspace path, a URL) can change under the same identity, so those
 * policies are skipped for them — only `contentHash` is safe there.
 */
function isImmutableRef(ref: ArtifactRef): boolean {
  return ref._tag === "GitBlob" || ref._tag === "Blob";
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

export interface ArtifactCacheKeyInput {
  readonly policy: ArtifactCachePolicy;
  readonly viewId: string;
  readonly ref: ArtifactRef;
  readonly input: unknown;
  readonly contentHash?: string | null | undefined;
  readonly sessionId?: string | undefined;
  readonly explicitKey?: string | undefined;
}

/**
 * Derives the cache key for a view call, or `null` when the call must not be
 * cached (policy `none`, an unhashable `contentHash` ref, a `ref`/`session`
 * policy on a mutable ref, or an `explicitKey` policy with no key supplied).
 */
export function artifactCacheKey(input: ArtifactCacheKeyInput): string | null {
  const inputKey = stableStringify(input.input);
  switch (input.policy) {
    case "none":
      return null;
    case "contentHash":
      return input.contentHash == null
        ? null
        : `${input.viewId}|ch|${input.contentHash}|${inputKey}`;
    case "ref":
      // Only safe for content-addressed refs; mutable refs would serve stale
      // results after an edit, so we decline to cache them.
      return isImmutableRef(input.ref)
        ? `${input.viewId}|ref|${artifactRefKey(input.ref)}|${inputKey}`
        : null;
    case "session":
      return isImmutableRef(input.ref)
        ? `${input.viewId}|session|${input.sessionId ?? "default"}|${artifactRefKey(input.ref)}|${inputKey}`
        : null;
    case "explicitKey":
      return input.explicitKey == null
        ? null
        : `${input.viewId}|key|${input.explicitKey}|${inputKey}`;
  }
}
