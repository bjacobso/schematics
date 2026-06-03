# @schema-ide/git-artifacts

A git-backed [`ArtifactStore`](../artifacts/src/store.ts) built on
[isomorphic-git](https://isomorphic-git.org/). The **same implementation** runs
against [Cloudflare Artifacts](https://developers.cloudflare.com/artifacts/) (Git
for agents) in a Worker and against a local checkout via `node:fs` — that's the
"isomorphic" half: one code path, two runtimes.

## Three layers

| Layer               | Module                                                 | Responsibility                                                                                                                                     |
| ------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — repo management | [`repo-provider.ts`](./src/repo-provider.ts)           | `ArtifactsRepoProvider` port over create/get/token/delete. Impls: `cloudflareArtifactsProvider(binding)`, `memoryRepoProvider()`.                  |
| 2 — git plumbing    | [`git-repo-backend.ts`](./src/git-repo-backend.ts)     | `GitRepoBackend` — `fetch`/`listTree`/`readBlob`/`stage`/`remove`/`commit`/`push`/`log`. Content is `Uint8Array` end-to-end.                       |
| 3 — store           | [`git-artifact-store.ts`](./src/git-artifact-store.ts) | `GitArtifactStore implements ArtifactStore`. Maps `ProjectFile`/`Path`/`GitBlob` refs ↔ git; lazy hydration; `commit()` → real git commit (+push). |

A worker-safe, dependency-free in-memory filesystem
([`mem-fs.ts`](./src/mem-fs.ts)) provides the isomorphic-git `fs` interface
without `node:fs`, so the backend runs inside a Cloudflare Worker and in tests.

## Cloudflare (remote) usage

```ts
import {
  cloudflareArtifactsProvider,
  createMemFs,
  makeGitArtifactStoreFromProvider,
} from "@schema-ide/git-artifacts";

const provider = cloudflareArtifactsProvider(env.SCHEMA_IDE_ARTIFACTS);
const store =
  yield *
  makeGitArtifactStoreFromProvider({
    provider,
    repo: workspaceId, // one Artifacts repo per workspace
    fs: createMemFs(),
    projectId: workspaceId,
  });
yield * store.write(ArtifactRef.projectFile("config/app.json", workspaceId), "{}");
yield * store.commit({ message: "Update app config", actor: "user" }); // commit + push
```

## Local (node) usage

Import from the `/node` subpath (pulls `node:fs`; keep it out of worker bundles):

```ts
import {
  findGitRoot,
  makeLocalGitArtifactStore,
  makeLocalGitCommitter,
} from "@schema-ide/git-artifacts/node";

// Full git-backed store over a local checkout:
const store = makeLocalGitArtifactStore({ dir, projectId }); // null if not a repo

// Or: commit files the host already wrote to disk (the CLI path):
const committer = makeLocalGitCommitter({ directory }); // null if not a repo
yield * committer.commit({ changed: ["config/app.json"], message: "Edit", author });
```

## Testing

`vitest` runs the entire stack in-memory (no Cloudflare account, no network): a
local `memoryRepoProvider` + `createMemFs()` exercises seed → stage → commit →
re-seed → hydrate, plus a real on-disk repo via `node:fs` in a temp dir.
