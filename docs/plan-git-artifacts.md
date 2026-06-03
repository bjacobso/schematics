# Plan: Git-backed artifact store over Cloudflare Artifacts

## Motivation

Our `ArtifactStore` today is backed by in-memory maps (`createMemoryArtifactStore`),
config providers (`HydratingArtifactStore`), or a Cloudflare Durable Object
(`packages/cloudflare/src/workspace-object.ts`). History is tracked by
`createVersionedArtifactStore` as _in-memory_ revisions that vanish on reload.

[Cloudflare Artifacts](https://developers.cloudflare.com/artifacts/) (beta since
2026-04-16) is a managed, **versioned, Git-compatible** storage service built for
agents. If we back an `ArtifactStore` with it, an artifacts _workspace_ becomes a
real Git repo: durable history, branches, content-addressed blobs, and a remote
any Git client can clone — instead of an ephemeral revision list.

The [isomorphic-git example](https://developers.cloudflare.com/artifacts/examples/isomorphic-git/)
is the key: the same JS git implementation runs against an in-memory filesystem
both locally (tests) and inside a Worker (prod) — truly isomorphic. That lets one
`GitArtifactStore` implementation serve both.

## Background: Cloudflare Artifacts surfaces

Three API surfaces:

1. **Workers binding** (`env.ARTIFACTS`) — manage repos:
   - `create(name, { readOnly?, description?, setDefaultBranch? })` → `{ name, remote, defaultBranch, token }`
   - `get(name)` → repo handle
   - `list({ limit?, cursor? })` → repos with `status` (`ready` | `importing` | `forking`)
   - `import({ source: { url, branch, depth }, target: { name, opts } })`
   - `delete(name)` → `boolean`
   - Repo handle: `createToken("read"|"write", ttlSeconds)` → `{ plaintext, scope, expiresAt }`,
     `listTokens()`, `revokeToken(id)`, `fork(name, opts?)`
2. **REST API** — same management ops from any platform, under
   `…/accounts/{ACCOUNT_ID}/artifacts/namespaces/{NAMESPACE}`.
3. **Git protocol** — standard smart-HTTPS remote at
   `https://<ACCOUNT_ID>.artifacts.cloudflare.net/git/<namespace>/<repo>.git`
   (clone/fetch v1+v2, push v1).

**Auth:** token `art_v1_<hex>?expires=<unix>`. For git Basic auth use
username `x`, password = the secret before `?expires=` (or `Authorization: Bearer
<full-token>` via `http.extraHeader`).

Crucially, **Cloudflare creates/manages repos but does not read/write files
inside them** — file I/O is done by a git client (isomorphic-git) over the remote.

## How this maps onto our model

| Our concept                                  | Git-backed mapping                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Artifacts _workspace_                        | one Cloudflare Artifacts **repo** (+ a working branch)                                                  |
| `ProjectFileArtifactRef { path, projectId }` | a path in the repo working tree at HEAD of the branch                                                   |
| `GitBlobArtifactRef { repo, oid }`           | a content-addressed git blob — immutable, pin-readable (currently defined in `ref.ts:16-20` but unused) |
| `BlobArtifactRef { id }`                     | a blob staged but not yet committed, or addressed by oid                                                |
| `ArtifactStore.read/write/create/delete`     | resolve path→oid in tree, read/stage blobs in the in-memory FS                                          |
| `entries` (Loaded/Pending skeleton)          | `ls-tree` of the fetched commit → `Pending` entries carrying oids; hydrate reads the blob               |
| `HydratingArtifactStore.sync`                | shallow fetch → list tree → stream blob hydration (same pattern, git-sourced)                           |
| `VersionedArtifactStore` revisions           | **real git commits** — see below                                                                        |
| `watch` events                               | emit on commit / fetch / push                                                                           |

## Proposed abstraction (three layers)

Keep the layers thin and swappable so tests run against a local repo and prod
runs against Cloudflare, with no change to consumers of `ArtifactStore`.

### Layer 1 — `ArtifactsRepoProvider` (port over repo management)

A small Effect-wrapped port mirroring the binding, so the backend never imports
`cloudflare:workers` directly:

```ts
interface ArtifactsRepoProvider {
  ensure(name: string, opts?): Effect<RepoHandle, ArtifactsError>; // get-or-create
  token(name: string, scope: "read" | "write"): Effect<GitCredential, ArtifactsError>;
  delete(name: string): Effect<void, ArtifactsError>;
}
interface RepoHandle {
  readonly name: string;
  readonly remote: string;
  readonly defaultBranch: string;
}
interface GitCredential {
  readonly username: "x";
  readonly password: string;
  readonly expiresAt: number;
}
```

Implementations: `cloudflareBindingProvider(env.ARTIFACTS)`, `restApiProvider(...)`,
and `localProvider(...)` (a bare repo on disk / in memory) for tests.

### Layer 2 — `GitRepoBackend` (isomorphic-git plumbing)

Wraps isomorphic-git against a `MemoryFS` (per the CF example) with the http
remote + token auth. Pure git plumbing, no `ArtifactStore` concepts:

```ts
interface GitRepoBackend {
  fetch(branch: string, depth?: number): Effect<{ commit: Oid }, GitError>; // shallow
  listTree(commit: Oid): Effect<readonly { path: string; oid: Oid; mode: string }[], GitError>;
  readBlob(oid: Oid): Effect<Uint8Array, GitError>;
  stage(path: string, content: Uint8Array): Effect<void, GitError>;
  remove(path: string): Effect<void, GitError>;
  commit(msg: string, author: GitAuthor): Effect<Oid, GitError>;
  push(branch: string): Effect<void, GitError>;
  log(branch: string, limit?: number): Effect<readonly GitCommit[], GitError>;
}
```

Content is `Uint8Array` end-to-end here — git is binary-native, so this fixes the
text-only assumption in the codec path and the base64 round-trip in the CF DO
store. (`ArtifactContent = string | Uint8Array` already supports it,
`store.ts:5`; the memory store handles bytes natively.)

### Layer 3 — `GitArtifactStore implements ArtifactStore`

Maps refs ↔ git per the table above and reuses the lazy/streaming pattern from
`HydratingArtifactStore`:

- `seed` → `fetch` (shallow) + `listTree` → emit `Pending` entries (skeleton),
  each carrying its blob `oid`.
- `read(ProjectFile)` → resolve path→oid → `readBlob` (lazy, memoized like the
  hydrating store's `memos`).
- `read(GitBlob)` → `readBlob(oid)` directly — immutable, no path resolution.
- `write`/`create`/`delete` → `stage`/`remove` in the working FS.
- A `commit(label, actor, turnId?, toolCallId?)` op → `commit` + `push`.
- `entries`/`watch` → as today, sourced from the tree + commit events.

## The versioning win

`createVersionedArtifactStore` (`store.ts:215-277`) models revisions as
in-memory patches with `actor`/`label`/`turnId`/`toolCallId` metadata. Git gives
us this for free and durably:

- A revision → a **commit**; metadata → author + message trailers
  (`Turn-Id:`, `Tool-Call-Id:`, `Actor:`).
- `undo`/`redo` → move the branch HEAD (or `revert`).
- History survives reload, and is inspectable by any git client.

We can either keep `VersionedArtifactStore` as the API and back its `apply`/`undo`/
`redo` with git, or expose a git-native history alongside it. (Decision below.)

## Relationship to plan-blob-artifacts.md (blobs)

These compose. A git repo is **content-addressed**, so the `External`/blob entry
idea in [plan-blob-artifacts.md](./plan-blob-artifacts.md) maps onto `GitBlobArtifactRef { repo, oid }`
naturally: large images/PDFs become entries we expose by reference rather than
hydrating bytes through sync.

With the browser-checkout model the bytes are already local (a FS read, not a
network fetch), so the `External` entry's `objectUrl` resolver mints an
embeddable URL on demand and caches it **keyed by `oid`** (free dedup — the same
image reused across the tree shares one URL), revoking on LRU eviction. The CF
git remote speaks smart-HTTP, not raw blob serving, so when a _durable,
shareable_ URL is needed (links, SSR), fall back to a small Worker route serving
a blob by oid. Tier selection (object URL · data URL · Worker route) is detailed
in plan-blob-artifacts.md's "Embeddable URLs" section, and the URL lifecycle —
an `RcMap` keyed by `oid` whose `lookup` calls `GitRepoBackend.readBlob`, with
`acquireRelease`/`Scope` guaranteeing revoke — in its "Lifecycle with Effect
Scope / RcMap" section.

## Open decisions

1. **Commit cadence.** Commit-per-write (every `apply` is a commit) vs.
   batch/debounce vs. explicit `commit()` calls (autosave-style). Affects history
   granularity and push traffic.
2. **Versioning surface.** Back `VersionedArtifactStore` with git, or add a
   git-native `history`/`log` API and deprecate the in-memory one.
3. **FS choice.** `MemoryFS` (CF example, ephemeral per request) vs. a persisted
   FS (e.g. LightningFS / Durable Object storage) to avoid re-fetching the tree
   every cold start.
4. **Fetch depth.** Always shallow `depth=1` (fast, no history locally) vs. deeper
   for local `log`/blame.

(Blob embedding URL — previously open — is now resolved: oid-keyed object URL by
default, data URL for small/portable, Worker route for shareable. See the
"Relationship" section above and plan-blob-artifacts.md.)

## Touch points & new code

- New `packages/git-artifacts/` (or fold into `packages/cloudflare/`):
  `ArtifactsRepoProvider`, `GitRepoBackend`, `GitArtifactStore`.
- `packages/artifacts/src/ref.ts` — actually consume `GitBlobArtifactRef`
  (currently returns `null` in `pathFromArtifactRef`, defined but unused).
- `packages/artifacts/src/store.ts` — possibly a git-backed `VersionedArtifactStore`.
- Reuse `HydratingArtifactStore` patterns (`packages/config-deploy/src/hydrating-store.ts`)
  for seed/sync/memoized hydration.
- **Dependencies:** add `isomorphic-git` (+ an http client; the iso example uses
  its `web`/`node` http modules). New Cloudflare Artifacts binding in wrangler
  config; `npx wrangler types` for the `Artifacts` env type.

## Sources

- https://developers.cloudflare.com/artifacts/
- https://developers.cloudflare.com/artifacts/examples/isomorphic-git/
- https://developers.cloudflare.com/artifacts/concepts/repositories/
- https://developers.cloudflare.com/artifacts/api/rest-api/
- https://developers.cloudflare.com/changelog/post/2026-04-16-artifacts-now-in-beta/
