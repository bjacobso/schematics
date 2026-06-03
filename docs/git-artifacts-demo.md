# End-to-end demo: Git-backed artifacts

This is the runbook for the two demo paths delivered by
[`@schema-ide/git-artifacts`](../packages/git-artifacts/). Both use the same
store implementation; only the provider + filesystem differ.

## What shipped

- **`packages/git-artifacts`** — the three-layer git-backed `ArtifactStore`
  (provider · backend · store) per [plan-git-artifacts.md](./plan-git-artifacts.md),
  with a worker-safe in-memory FS. The git library runs in Node (the CLI) and is
  ready for browser use; it is **not** imported by the API worker (see below).
- **Cloudflare wiring** — an optional `SCHEMA_IDE_ARTIFACTS` Cloudflare Artifacts
  binding on the API worker. Per the [Alchemy Artifacts model](https://v2.alchemy.run/tutorial/cloudflare/artifacts/),
  the Worker **provisions** a per-workspace Git repo and **mints a scoped token**
  — it does not run git itself (which would pull isomorphic-git + `crc-32`/`buffer`
  into the Worker bundle, where they don't resolve). `clone`/`push` happen against
  the remote from a Git client. The create-workspace response returns
  `{ git: { remote, defaultBranch, token, expiresAt } }` when the binding is set.
- **Local CLI** — when `schema-ide serve <dir>` runs inside a git repo, the
  `history` capability turns on and each change is committed to that repo using
  the developer's own git (isomorphic-git over `node:fs` — no Worker involved).

## Path A — Local (git command, no cloud)

```bash
cd ~/my-config-repo            # a directory inside a git repo
git init                       # if it isn't one yet
npx schema-ide serve .         # serves the local IDE on http://localhost:4318
```

Edit files in the IDE (or have the agent edit them). Each change lands on disk
**and** is committed:

```bash
git log --oneline              # one commit per workspace change
#   a1b2c3d Write config/app.json
#   e4f5a6b Create forms/intake.json
```

Outside a git repo the IDE still works exactly as before (history capability off,
plain filesystem writes) — git is purely additive.

## Path B — Cloudflare Artifacts (deploy)

Requires a Cloudflare account with the **Artifacts beta** enabled.

```bash
# 1. Enable the binding (opt-in — unset = today's Durable-Object-only behavior).
export SCHEMA_IDE_ARTIFACTS_NAMESPACE=schema-ide-workspaces

# 2. Deploy the worker + playground via Alchemy.
pnpm playground:deploy

# 3. Create a workspace (POST /v1/workspaces). The response includes a `git`
#    object with the repo remote and a short-lived write token:
#    { "workspaceId": "...", "url": "/w/...", "git": { "remote": "...", "token": "...", ... } }

# 4. Clone/push the workspace repo with any git client, authenticating with the
#    minted token (Basic auth: username `x`, password = the token):
git clone https://x:<token>@<ACCOUNT_ID>.artifacts.cloudflare.net/git/schema-ide-workspaces/<workspaceId>.git
```

The Alchemy binding (`makeSchemaIdeArtifactsNamespace`) is declared in
[`packages/cloudflare/src/alchemy.ts`](../packages/cloudflare/src/alchemy.ts) and
wired in [`alchemy/schema-ide-api-worker.ts`](../alchemy/schema-ide-api-worker.ts);
repo provisioning + token minting (binding-only, no git implementation in the
Worker) lives in
[`packages/cloudflare/src/git-repos.ts`](../packages/cloudflare/src/git-repos.ts)
and runs in `createHostedWorkspace`.

> **Why no server-side commits?** isomorphic-git's transitive deps (`crc-32`,
> `clean-git-ref`, `buffer`) don't resolve in the Worker bundle under pnpm, and
> the Alchemy/Cloudflare model is for the Worker to provision repos and hand out
> tokens — not to run git. Server-driven commits (e.g. the browser pushing edits
> with isomorphic-git client-side) are a follow-up.

## Tested without an account

`pnpm --filter @schema-ide/git-artifacts test` runs the whole flow in-memory
(`memoryRepoProvider` + in-memory FS) and against a real on-disk repo in a temp
directory — no Cloudflare account or network required. The only thing it can't
exercise locally is the actual smart-HTTP push to Cloudflare's remote, which
needs beta credentials.
