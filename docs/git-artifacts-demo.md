# End-to-end demo: Git-backed artifacts

This is the runbook for the two demo paths delivered by
[`@schema-ide/git-artifacts`](../packages/git-artifacts/). Both use the same
store implementation; only the provider + filesystem differ.

## What shipped

- **`packages/git-artifacts`** — the three-layer git-backed `ArtifactStore`
  (provider · backend · store) per [plan-git-artifacts.md](./plan-git-artifacts.md),
  with a worker-safe in-memory FS so it runs in a Worker and in tests.
- **Cloudflare wiring** — an optional `SCHEMA_IDE_ARTIFACTS` Cloudflare Artifacts
  binding on the API worker. When present, each hosted workspace is **mirrored to
  a per-workspace Git repo**: the template is the initial commit, and every
  workspace change becomes a commit (best-effort; the Durable Object stays the
  source of truth).
- **Local CLI** — when `schema-ide serve <dir>` runs inside a git repo, the
  `history` capability turns on and each change is committed to that repo using
  the developer's own git.

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

# 3. Create a workspace in the deployed playground (POST /v1/workspaces),
#    then edit it. Every revision is committed to its Artifacts repo.

# 4. Clone the workspace's repo with any git client:
git clone \
  https://<ACCOUNT_ID>.artifacts.cloudflare.net/git/schema-ide-workspaces/<workspaceId>.git
```

The Alchemy binding (`makeSchemaIdeArtifactsNamespace`) is declared in
[`packages/cloudflare/src/alchemy.ts`](../packages/cloudflare/src/alchemy.ts) and
wired in [`alchemy/schema-ide-api-worker.ts`](../alchemy/schema-ide-api-worker.ts);
the mirror lives in
[`packages/cloudflare/src/git-mirror.ts`](../packages/cloudflare/src/git-mirror.ts)
and is invoked from the workspace Durable Object.

## Tested without an account

`pnpm --filter @schema-ide/git-artifacts test` runs the whole flow in-memory
(`memoryRepoProvider` + in-memory FS) and against a real on-disk repo in a temp
directory — no Cloudflare account or network required. The only thing it can't
exercise locally is the actual smart-HTTP push to Cloudflare's remote, which
needs beta credentials.
