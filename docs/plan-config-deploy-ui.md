# Plan: Driving alchemy from the UI

How a user, starting from a **blank config** for a consumer like Onboarded, would
connect (auth + endpoints), then **start / monitor / plan / apply** a config-as-code
deployment from inside `<Schematics />`. Status: **phases 1–3 implemented, 4 partial, 5 pending** (see Phasing).

## Goal

Turn the headless lifecycle (`pull → edit → plan → apply → destroy`, today only a
CLI/`makeOnboardedConfigDeploy`) into an interactive UI flow:

```
Connect ─▶ Bootstrap (pull, streaming) ─▶ Edit (existing IDE) ─▶ Plan ─▶ Apply ─▶ Monitor / Drift
```

The editing half already exists (`<Schematics />`: file tree, schema form, diagnostics,
timeline, chat). This plan adds the **connection** and **deploy** halves and wires
them to the reflection/event surfaces we already have.

## Where the engine runs (the key architectural decision)

The provider CRUD calls hit an external API with **secrets** and across **CORS**.
So the engine must NOT run in the browser. It runs **server-side** (the
`@schematics/server` app or the Cloudflare worker, which already hosts workspaces
via `SchematicsWorkspaceObject`), holding credentials and the working-tree
`ArtifactStore`. The UI drives it over the Effect `HttpApi` (`@schematics/protocol`)
and receives progress on an **event stream**.

```
 <Schematics/>  ──HttpApi /v1/deploy──▶  server/worker
   (Deploy panel)                        makeOnboardedConfigDeploy({ store, api: realAdapter })
        ▲                                   │  engine: pull/plan/apply/destroy
        └────── SyncEvent / run events ◀────┘  ArtifactStore (workspace DO) + lockfile + secret store
```

## From a blank config: the Connect step

A setup wizard (new) captures a **Connection** before any files exist:

1. **Choose the consumer config** — e.g. "Onboarded account". Selects which
   provider set / `ConfigProvider`s and config schemas to load (today:
   `makeOnboardedConfigDeploy`).
2. **Auth** — credential entry (Bearer `api_token` for Onboarded), validated by a
   live `whoami`/list probe before saving. The secret is stored **server-side**
   (worker Secret binding / KV / a secret-ref), never in the browser or in files.
3. **Target / scope** — base URL + environment (prod/sandbox), account id (from the
   token), and **which entity kinds / endpoints** to manage (account, custom
   properties, forms, policies, automations — a checklist that narrows the provider
   registry).
4. **Create connection** → persists `{ consumer, target, env, account, secretRef,
enabledKinds }` as a small connection record (a `Project`-scoped artifact or a
   server-side store).

The output is a configured `ConfigDeploy` instance on the server, ready to pull.

## Bootstrap: streaming pull (already designed)

"Start sync" runs `HydratingArtifactStore.seed` + `sync` (see
[plan-blob-artifacts.md] sibling work): list endpoints lay out a **skeleton** of
`Pending` files instantly; content hydrates lazily / in the background. The
existing `store.watch` (`created → hydrated`) drives the **file tree filling in
live**, and the `sync` stream's `listed / hydrated / failed` events drive a
**progress bar**. From a blank config this is the "import my account" moment.

## Plan & Apply in the UI

- **Plan** → call `deploy.plan`, render the typed `ConfigPlan` into the
  **reflection stream** as a dedicated panel. `renderPlan` already produces the
  Terraform-style text; the panel shows per-resource `create/update/delete` with
  the field-level diffs we already compute, grouped by entity kind, with links
  back to the source file.
- **Apply** → gated approval modal (mirrors the CLI's `--auto-approve`): show the
  plan, require explicit confirm, offer `allowDelete`. Streams per-change results
  (`applied / aborted / skipped`, with `remote-changed` aborts surfaced as
  conflicts to re-plan).
- **Drift** → re-`plan` on demand (or scheduled) and badge files whose live state
  diverged from the working tree.

## Monitor: a Run model

Introduce a **Run** (one plan or apply execution) so the UI can show live status
and history:

```ts
interface DeployRun {
  id;
  kind: "pull" | "plan" | "apply" | "destroy";
  status: "running" | "succeeded" | "failed" | "aborted";
  startedAt;
  finishedAt?;
  events: ReadonlyArray<SyncEvent | ResourceChangeEvent>; // streamed
  summary?: PlanSummary | ApplyResult;
}
```

Runs stream over the same event channel and land in the existing **timeline**
panel (reuse it — runs sit alongside edit revisions). The engine already returns
structured `ApplyResult { applied, aborted, skipped }` and `ConfigPlan`; we just
need to (a) emit per-change progress events during `apply`, and (b) persist runs.

## Mapping to existing primitives

| UI need                           | Existing primitive                                                           |
| --------------------------------- | ---------------------------------------------------------------------------- |
| working tree, skeleton, streaming | `HydratingArtifactStore` (`seed` / `sync` / `watch`)                         |
| lifecycle                         | `makeConfigDeploy` / `makeOnboardedConfigDeploy` verbs                       |
| plan rendering                    | `ConfigPlan` + `renderPlan` (+ field diffs)                                  |
| transport                         | `@schematics/protocol` Effect `HttpApi` + the react artifact-project client  |
| server host + secrets + store     | `@schematics/server`, `@schematics/cloudflare` (`SchematicsWorkspaceObject`) |
| real API calls                    | a concrete `OnboardedApi` adapter (replaces the mock)                        |
| diagnostics / timeline panels     | `<Schematics />` reflection + timeline                                       |

## Net-new work

1. **HttpApi deploy group** (`/v1/deploy`): `connect`, `pull`, `plan`, `apply`,
   `destroy`, `runs`, and an event stream (SSE or DO WebSocket).
2. **Per-change apply events** in the engine (emit as each `reconcile`/delete
   completes) so apply is observably incremental, not just a final result.
3. **Connection + Run stores** (server-side) + a **secret-ref** mechanism so tokens
   never touch the browser or the file tree.
4. **Real `OnboardedApi` adapter** over the Onboarded internal HttpApi (the port +
   tests exist; this is the live implementation).
5. **React surfaces**: Connect wizard, Deploy panel (plan view + apply modal), sync
   progress, Runs in the timeline. New components in `@schematics/ide`.

## Security

- Secrets live only server-side (worker Secret/KV), referenced by id from the
  connection; the UI sees "connected as <account>", never the token.
- Apply is always explicit-approval by default; deletes need a second opt-in.
- The lockfile (`config.lock.json`) stays in the workspace store (it maps slugs →
  remote ids, not secrets) and is reviewable.

## Phasing

1. ✅ **Server**: `/v1/deploy` RPC group (`@schematics/protocol` `SchematicsDeployRpcGroup`)
   over `makeOnboardedConfigDeploy` against the workspace store + mock adapter;
   connect/pull/plan/apply/destroy/runs. Bridged by `makeOnboardedDeployService`
   (`@schematics/onboarded-config`) and routed at `/v1/deploy/rpc` via the server
   `deploy` option. (Used RPC over the protocol's Effect transport rather than a
   bespoke HttpApi group so streaming + the existing react RPC client compose.)
2. ✅ **Streaming**: per-change apply events emitted by the engine
   (`ApplyOptions.onEvent`) + run/plan/sync events broadcast on the `WatchDeploy`
   stream. (Pull currently derives `sync-listed`/`sync-hydrated` from the engine
   `pull`; lazy `HydratingArtifactStore.sync` hydration over the wire is a follow-up.)
3. ✅ **React**: `SchematicsDeployPanel` (connect form, plan view with field diffs,
   gated apply modal with `allowDelete`, sync progress) + Runs timeline +
   `createRpcDeployClient` + `useSchematicsDeploy`. Optional `deploy` prop +
   "Deploy" toggle wired into `<Schematics />`.
4. ◑ **Connect** + connection/secret store + real `OnboardedApi` adapter:
   server-side `DeploySecretStore` (token referenced by connection id, never
   returned), live `whoami` probe on connect, inline connect form, and
   `makeOnboardedHttpApi` (live REST adapter scaffold — route templates are
   best-effort, see `DEFAULT_ONBOARDED_HTTP_ROUTES`). A full multi-step wizard
   (consumer/scope selection) remains.
5. ◻ **Drift** (re-plan surfaces drifted resources via `driftPaths`; scheduled
   re-plan + file-tree badges remain) and multi-environment connections.

Host apps compose the engine by passing `makeOnboardedDeployService({ store, … })`
to the server's `deploy` option (the server stays consumer-agnostic).

## Open questions

- **Engine host**: standalone server vs the Cloudflare worker/DO (the DO already
  owns the per-workspace store + lifecycle — likely the natural home).
- **Event transport**: SSE (simple, one-way) vs Durable Object WebSocket
  (bidirectional, fits hosted workspaces).
- **Connection storage**: a `Project`-scoped artifact vs a separate server table;
  and whether multiple connections (envs/accounts) attach to one workspace.
- **Agent integration**: expose `plan`/`apply` as artifact views/tools so the chat
  agent can propose and (with approval) run a deploy.
