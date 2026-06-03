# Plan: Blob/external entries (embed-by-URL instead of syncing content)

## Motivation

The `HydratingArtifactStore` streams config content through a sync step: `seed`
creates `Pending` skeleton entries, then `sync` hydrates each into `Loaded`
content. This is right for text config (YAML/JSON), but wrong for binary blobs
— images, PDFs, etc. We don't want to pull megabytes of bytes through the sync
pipeline and into JS memory. Instead we want to **flag the entry as a blob in
the file tree and hand the UI a URL to embed** (`<img>`, `<iframe>`/`<embed>`,
or a download link).

## Core idea

Today `ArtifactStoreEntry = Loaded | Pending`, distinguished by _content
presence_. A blob is a third, terminal state: content lives elsewhere and we
deliberately never sync it — we carry a URL instead. So it's a new variant of
the entry union, not a flavor of `Pending`.

## Changes

### 1. New entry variant — `packages/artifacts/src/store.ts`

```ts
export interface ExternalArtifactStoreEntry {
  readonly _tag: "External";
  readonly ref: ArtifactRef;
  readonly mimeType?: string; // UI picks <img> vs <iframe>/<embed> vs download link
  readonly byteSize?: number; // optional, for "12 MB PDF" affordances
  // Resolve an embeddable URL lazily; caller releases it when the view unmounts.
  // A remote-hosted blob returns its CDN url with a no-op release; a local
  // (git) blob mints an object/data URL on demand. See "Embeddable URLs" below.
  readonly objectUrl: Effect.Effect<{ readonly url: string; readonly release: () => void }>;
}

export type ArtifactStoreEntry =
  | LoadedArtifactStoreEntry
  | PendingArtifactStoreEntry
  | ExternalArtifactStoreEntry;

export const externalEntry = (ref, objectUrl, opts?) => ({
  _tag: "External",
  ref,
  objectUrl,
  ...opts,
});
export const isExternalEntry = (e): e is ExternalArtifactStoreEntry => e._tag === "External";
```

The entry carries a **URL resolver**, not a frozen `url: string` — because a
git-local blob has no fixed remote URL (its content is local bytes we turn into
a URL on demand), while a remote-hosted blob just wraps its CDN URL. Same shape,
both backends.

Non-breaking: existing `Loaded`/`Pending` guards stay valid. Snapshot / patch /
revision paths (`store.ts:101-133`) keep keying off `LoadedArtifactStoreEntry`,
so blobs never enter undo/redo history — correct, we don't version a
CDN-hosted PDF the way we version a YAML file.

### 2. Providers declare blob-ness up front — `packages/alchemy/src/provider.ts`

The blob must be declared during the cheap list pass (the whole point: avoid
fetching bytes). `RemoteSummary` grows an optional blob descriptor:

```ts
export interface RemoteSummary {
  readonly remoteId: string;
  readonly suggestedKey: string;
  readonly summary?: unknown;
  readonly blob?: { readonly url: string; readonly mimeType?: string; readonly byteSize?: number };
}
```

Uploaded PDFs/images usually already have a storage/CDN URL, so list endpoints
can populate this with no extra round-trip.

### 3. `seed` / `sync` — `packages/alchemy/src/hydrating-store.ts`

In `seed` (~line 122), branch on `summary.blob`:

- **blob present** → register an `External` entry directly; do **not** create a
  `memo`/descriptor for fetching; `publish` a `created` (or new `linked`) event.
  It's already terminal.
- **no blob** → today's path (`Pending` + memoized fetch).

`sync` then skips blobs (nothing to hydrate). Surface them in the stream anyway
so progress counts add up. `entries` (~line 182) returns `External` entries
alongside `Loaded`/`Pending`.

## Embeddable URLs (resolving `objectUrl`)

For an `<img src>`/`<iframe>`, the UI needs a URL. How we mint one depends on
where the bytes live. Three tiers:

- **Object URL** (`URL.createObjectURL(new Blob([bytes]))`) — the default for
  browser embedding of binaries. Zero size bloat, browser streams from it, ideal
  for multi-MB PDFs/images. Cost: must `revokeObjectURL` (that's what `release`
  is for) or it leaks for the page lifetime; not serializable; invalid after
  reload / in another tab.
- **Data URL** (`data:<mime>;base64,…`) — for small/portable cases. Self-contained,
  serializable, survives reload, no lifecycle. Cost: ~33% bloat and the whole
  file lives as a string in the DOM — bad for large blobs. Heuristic: `byteSize <
~256 KB` → data URL, else object URL.
- **Worker blob route** (`GET /blob/:oid`) — when a URL must be _durable and
  shareable_ (sending a link, server-side rendering, no `createObjectURL`
  available). This is the only tier that works outside the originating browser tab.

For the **git backend**, blobs are content-addressed by `oid`, so `objectUrl`
reads the blob, caches an object URL keyed by `oid` (free dedup — the same image
reused across the tree shares one URL), and revokes on LRU eviction. For a
**remote-hosted blob**, `objectUrl` returns the existing CDN `url` with a no-op
`release`.

## Lifecycle with Effect Scope / RcMap

An object URL is a textbook acquire/release resource and the oid-keyed cache is a
reference-counted map — both fall out of Effect primitives, so revoke is
guaranteed (even on failure/interruption) rather than hand-managed.

**One URL = one `acquireRelease`.** Acquire mints, release revokes; the `Scope`
in the requirements channel forces a declared owner:

```ts
import { Effect, Scope, RcMap, Exit } from "effect";

const acquireObjectUrl = (bytes: Uint8Array, mime: string) =>
  Effect.acquireRelease(
    Effect.sync(() => URL.createObjectURL(new Blob([bytes], { type: mime }))),
    (url) => Effect.sync(() => URL.revokeObjectURL(url)),
  ); // Effect<string, never, Scope>
```

**The scope = the UI lifetime.** An open viewer is a scope; closing it revokes:

```ts
Effect.scoped(
  Effect.gen(function* () {
    const url = yield* acquireObjectUrl(bytes, mime);
    yield* renderViewer(url); // revoked when this returns or is interrupted
  }),
);
```

**`RcMap` = the oid cache (dedup + refcount + LRU).** `get` acquires (refcount++)
and decrements when the borrowing scope closes; the URL is revoked only after the
last viewer closes **and** the idle TTL lapses, with `capacity` bounding memory:

```ts
const makeBlobUrls = (backend: GitRepoBackend) =>
  RcMap.make({
    lookup: (oid: string) =>
      Effect.gen(function* () {
        const bytes = yield* backend.readBlob(oid); // local FS read
        return yield* acquireObjectUrl(bytes, mimeFor(oid));
      }),
    idleTimeToLive: "30 seconds", // keep warm briefly after last viewer closes
    capacity: 64, // LRU-evict beyond this
  }); // Effect<RcMap<string, string>, never, Scope>

const url = yield * RcMap.get(blobUrls, oid); // Effect<string, E, Scope>
```

**Scope nesting matches the workspace hierarchy.** `RcMap` is itself scoped, so it
lives on the session/workspace scope; per-viewer scopes borrow entries. Closing
the workspace releases the `RcMap`, which revokes every URL still outstanding:

```
workspace scope ── owns ──> RcMap
   └─ viewer scope ── borrows ──> RcMap.get(oid)   (revoked on close + TTL)
```

**Bridging to the `{ url, release }` resolver** (consumers are React, not Effect):
allocate a detached child scope and hand its close back as `release` — straight
into a `useEffect` cleanup. Refcount/TTL/LRU still apply underneath:

```ts
const objectUrl = (oid: string) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const url = yield* RcMap.get(blobUrls, oid).pipe(Scope.extend(scope));
    const release = () => Effect.runFork(Scope.close(scope, Exit.void));
    return { url, release };
  });
```

The **data-URL tier needs none of this** — it's a plain value with no finalizer
(`Effect.succeed(\`data:${mime};base64,${b64}\`)`), so the scoped machinery is
paid only for large object-URL blobs.

## Open decisions

1. **`read()` on a blob.** `ArtifactStore.read` returns `string | Uint8Array`,
   but a blob has no in-store content. Options:
   - **(recommended) Fetch-on-demand** — `read` lazily downloads bytes from the
     URL into the cache. UI embeds via the entry's `url` (never touches `read`),
     but the door stays open for paths that need the actual bytes (e.g.
     re-deploy). Less surprising contract.
   - **Refuse** — `read` fails with a new `external` reason, forcing callers
     through `url`. Keeps bytes out of JS memory entirely.

2. **Sync event shape.** Add a dedicated `{ _tag: "linked"; ref; url }` to
   `SyncEvent` (`hydrating-store.ts:29`), or fold blobs into existing events for
   the progress counter.

## Touch points

- `packages/artifacts/src/store.ts` — entry union, constructors, guards
- `packages/alchemy/src/provider.ts` — `RemoteSummary.blob`
- `packages/alchemy/src/hydrating-store.ts` — `seed`, `sync`, `entries`,
  (maybe) `read`, `SyncEvent`
- Tests: hydration tests covering a blob summary → `External` entry, sync skips
  hydration, progress count includes it.
