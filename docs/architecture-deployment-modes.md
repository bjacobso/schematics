# Architecture: deployment modes & data flow

How Schematics actually runs, end to end, in each of its three modes — and where
the data and services live in each. This is the map that
[plan-onboarded-config-e2e-demo.md](./plan-onboarded-config-e2e-demo.md) builds
on; read that for the _demo_ story, read this for the _topology_.

All file:line references are anchors into the current tree, not contracts.

## The three modes at a glance

|                 | **Local serve**                             | **Playground (memory)**               | **Cloudflare hosted**                                          |
| --------------- | ------------------------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| Entry           | `schematics serve <dir>`                    | static SPA, no server                 | API worker + Playground worker                                 |
| Artifact store  | `FsArtifactStore` on disk                   | `createMemoryArtifactStore` (browser) | Durable Object storage mirrored to browser git                 |
| Store mode      | `local-filesystem`                          | `memory`                              | `remote`                                                       |
| Where edits run | Node server, RPC                            | in-browser                            | Durable Object RPC, then browser-side git commit/push          |
| Agent tool loop | **browser**, writes via RPC                 | **browser**, writes in-memory         | **browser**, writes via RPC                                    |
| Chat/LLM        | `/v1/chat` → OpenRouter                     | `/v1/chat` → OpenRouter               | `/v1/chat` → OpenRouter (shared worker)                        |
| Deploy engine   | optional `/v1/deploy/rpc` (server-side)     | in-browser, mock API                  | in-browser hosted demo against mock API, backed by browser git |
| Git / history   | local git repo (node `fs`), `history: true` | none                                  | browser git clone pushed through worker proxy, `history: true` |
| Provenance      | one commit per change                       | in-memory revisions                   | browser git trailers for hosted edits/deploys                  |

The constant across all three: the **same** `SchematicsArtifactProjectRpcGroup`
contract (`protocol/src/artifact-project.ts:260`) and the **same** browser-side
agent tool loop. Only the store implementation and where it lives change.

---

## Mode selection — how the playground picks a backend

The playground SPA probes at startup (`apps/playground/src/main.tsx:40-184`):

```mermaid
flowchart TD
  start([Playground boots]) --> hosted{"URL is /w/{id}?"}
  hosted -- yes --> cf["mode = cloudflare<br/>createRpcArtifactProjectClient(apiBaseUrl,<br/>/v1/workspaces/{id}/rpc)"]
  hosted -- no --> envset{"VITE_SCHEMATICS_API_BASE_URL set?"}
  envset -- yes --> mem1["skip local probe"]
  envset -- no --> probe["probe local server:<br/>createRpcArtifactProjectClient(apiBaseUrl)<br/>.getCapabilities()"]
  probe -- success --> local["mode = local-filesystem<br/>(talk to Node server RPC)"]
  probe -- "refused" --> mem2["mode = memory"]
  mem1 --> mem["createSchematicsArtifactClient(...)<br/>in-browser store"]
  mem2 --> mem
  cf --> done([render IDE])
  local --> done
  mem --> done
```

Three terminal states → three modes. The same React surface renders all three;
it just receives a different artifact-project client.

---

## Mode A — Local `schematics serve <dir>`

A Node HTTP server (`packages/server/src/node.ts:28`, default port ~4317/4318)
serves both the RPC API and the static SPA. The store is the developer's
directory; if that directory is a git repo, every change is committed.

```mermaid
flowchart LR
  subgraph browser["Browser — Playground SPA"]
    ui["React IDE surface"]
    apc["RPC artifact-project client<br/>artifact-project-client.ts:291"]
    chat["chat adapter<br/>openrouter-proxy-runtime.ts:42"]
    tools["agent tool loop<br/>executeSchematicsToolCall (browser)"]
    ui --> apc
    ui --> chat
    chat --> tools
    tools --> apc
  end

  subgraph node["Node server — schematics serve"]
    rpc["/v1/artifact-project/rpc<br/>NDJSON (app.ts:83)"]
    chatapi["/v1/chat<br/>(http-api.ts)"]
    deployrpc["/v1/deploy/rpc<br/>(optional, app.ts:100)"]
    static["static assets / SPA"]
    svc["local artifact-project client<br/>local-artifact-project-client.ts"]
    fsstore["FsArtifactStore (on disk)"]
    committer["LocalGitCommitter<br/>isomorphic-git over node:fs"]
    engine["ConfigDeploy engine<br/>(holds credentials)"]
    rpc --> svc --> fsstore
    svc --> committer
    deployrpc --> engine
  end

  subgraph disk["Developer's filesystem"]
    files["account.yaml, forms/*, policies/*<br/>config.lock.json"]
    gitrepo[".git (local repo)"]
  end

  subgraph ext["External"]
    or["OpenRouter API"]
    onb["Onboarded API (live or mock)"]
  end

  apc -->|HTTP NDJSON| rpc
  chat -->|HTTP| chatapi
  apc -.deploy.-> deployrpc
  fsstore --> files
  committer --> gitrepo
  chatapi --> or
  engine --> onb
  engine --> fsstore
```

Key facts:

- **Agent runs in the browser.** The chat adapter calls `/v1/chat` (a thin
  OpenRouter proxy), then executes tool calls _locally in the browser_. Tool
  writes go back over the artifact-project RPC, so they hit the Node store and
  get committed — the agent never touches the server store directly.
- **`history` is on** because `gitCommitter !== null`
  (`cli/src/local-artifact-project-client.ts`). Each `ApplyArtifactProjectChange`
  becomes one git commit with the change label as the message.
- **Deploy runs server-side** when the deploy RPC is wired: the engine holds the
  credentials and the working-tree store, and the browser just drives
  pull/plan/apply over `/v1/deploy/rpc`.

### Local change → commit (sequence)

```mermaid
sequenceDiagram
  participant U as User / Agent (browser)
  participant C as RPC client
  participant S as Node server (svc)
  participant F as FsArtifactStore
  participant G as LocalGitCommitter
  participant R as .git repo

  U->>C: ApplyArtifactProjectChange(write forms/x.yaml)
  C->>S: HTTP NDJSON
  S->>F: write file to disk
  S->>G: commit({changed, deleted, message, author})
  G->>R: stage + commit (isomorphic-git / node:fs)
  R-->>G: oid
  S-->>C: change response (new snapshot)
  Note over R: git log shows one commit per change
```

---

## Mode B — Playground (in-browser memory)

No server. The SPA constructs an in-memory store and runs everything client-side.
Used for examples and the in-browser deploy demo.

```mermaid
flowchart LR
  subgraph browser["Browser — Playground SPA (only runtime)"]
    ui["React IDE surface"]
    mem["in-memory artifact client<br/>createSchematicsArtifactClient<br/>+ createMemoryArtifactStore"]
    runtime["SchematicsArtifactRuntime<br/>(schema validation, reflection)"]
    chat["chat adapter"]
    tools["agent tool loop (browser)"]
    deploy["makeOnboardedDeployService<br/>(in-browser, shared deployStore)"]
    mockapi["mock OnboardedApi<br/>seedOnboardedData"]
    ui --> mem --> runtime
    ui --> chat --> tools --> mem
    ui --> deploy --> mockapi
    deploy --> mem
  end

  subgraph ext["External (only if apiBaseUrl set)"]
    or["/v1/chat → OpenRouter"]
  end

  chat -. optional .-> or
```

Key facts:

- **Everything is in the browser**, including the deploy engine — `pull/plan/apply`
  run against the in-memory mock Onboarded API (`mock/seed.ts`), writing into the
  _same_ `deployStore` the IDE renders, so Pull visibly fills the file tree
  (commits 89f4e6c / 808d6cf).
- **No git, no persistence.** History is the in-memory `VersionedArtifactStore`
  revisions; a reload loses everything. This is exactly the ephemerality the
  e2e-demo plan replaces with git.
- Chat still needs a `/v1/chat` endpoint somewhere (the playground worker or a
  local server) unless the example is non-agentic.

---

## Mode C — Cloudflare hosted

Two workers. The **Playground worker** serves the SPA; the **API worker** owns
workspace creation, per-workspace Durable Objects, chat, and git-repo
provisioning/proxying. Each workspace is one Durable Object instance with its
own storage, plus a per-workspace Artifacts git repo when the
`SCHEMATICS_ARTIFACTS` binding is configured.

```mermaid
flowchart TB
  subgraph browser["Browser — SPA at /w/{id}"]
    ui["React IDE surface"]
    apc["RPC client →<br/>/v1/workspaces/{id}/rpc"]
    hgit["HostedGitCommitter<br/>isomorphic-git + mem-fs"]
    deploy["hosted deploy demo<br/>makeOnboardedDeployService"]
    chat["chat adapter → /v1/chat"]
    tools["agent tool loop (browser)"]
    ui --> apc
    ui --> hgit
    ui --> deploy --> hgit
    ui --> chat --> tools --> apc
  end

  subgraph pw["Playground Worker"]
    spa["static SPA assets<br/>VITE_SCHEMATICS_API_BASE_URL"]
  end

  subgraph api["API Worker (cloudflare/worker-runtime.ts)"]
    route["router (worker-runtime.ts:46)"]
    create["POST /v1/workspaces → createHostedWorkspace"]
    rpcfwd["POST /v1/workspaces/{id}/rpc<br/>→ rewrite → DO"]
    gitproxy["/v1/workspaces/{id}/git/*<br/>Git smart-HTTP proxy"]
    chatw["/v1/chat → OpenRouter proxy"]
    route --> create
    route --> rpcfwd
    route --> gitproxy
    route --> chatw
  end

  subgraph do["Durable Object per workspace (workspace-object.ts:70)"]
    dorpc["SchematicsArtifactProjectRpcGroup<br/>(mode=remote)"]
    dostore["DO storage:<br/>file:{path}, change:{rev}, metadata"]
    dorpc --> dostore
  end

  subgraph cf["Cloudflare Artifacts (SCHEMATICS_ARTIFACTS)"]
    repo["per-workspace git repo<br/>provisionWorkspaceRepo (git-repos.ts:32)"]
  end

  subgraph ext["External"]
    or["OpenRouter API"]
  end

  browser -->|load SPA| pw
  apc -->|HTTP NDJSON| rpcfwd --> dorpc
  hgit -->|clone/fetch/push smart HTTP| gitproxy --> repo
  deploy -->|replaceFiles after commit| apc
  chat --> chatw --> or
  create -->|get/create repo| repo
  create -.->|"git: {remote, defaultBranch}<br/>proxied remote only"| browser
  hgit -. "committed snapshot mirrors back" .-> dostore
```

Key facts:

- **The DO remains the RPC source of truth for hosted workspace files.** Files
  live as `file:<path>` keys; each `applyChange` runs in a storage transaction,
  bumps a revision, and writes a `change:<rev>` changelog entry with
  `{actor, label, changedPaths}` (`workspace-object.ts:193`).
- **Git is the hosted history/provenance mirror used by the playground.**
  `createHostedWorkspace` calls `provisionWorkspaceRepo` best-effort and returns
  a proxied smart-HTTP remote (`/v1/workspaces/:id/git`). The browser clones or
  initializes that repo in `mem-fs`, commits the initial DO snapshot, pushes user
  edits and deploy pull/apply commits, and serves History from the browser-side
  git clone.
- **Tokens do not reach the browser.** The worker proxy forwards smart-HTTP bytes
  to the Artifacts remote and injects short-lived Artifacts credentials
  server-side.
- **The worker can't run git** (`isomorphic-git`/`crc-32` won't bundle), which is
  why clone/fetch/stage/commit/push happen browser-side through the worker proxy.
- **Per-stage isolation:** the Artifacts namespace is stage-scoped
  (`…-pr-20`, `…-prod`), so preview/staging/prod workspaces never collide
  (`packages/cloudflare/src/alchemy.ts`).
- **No server-side deploy RPC is exposed in hosted mode.** The playground's
  hosted Onboarded demo runs the mock deploy service in the browser against the
  same browser git store, then mirrors committed snapshots back to the DO.

### Hosted: create → edit / deploy (sequence)

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API Worker
  participant D as Workspace DO
  participant R as Artifacts repo
  participant G as Browser git store

  B->>A: POST /v1/workspaces
  A->>D: /internal/initialize (template files)
  A->>R: get-or-create repo
  R-->>A: {remote, defaultBranch}
  A-->>B: {workspaceId, url:/w/{id}, git:{...}}
  B->>D: getSnapshot via /v1/workspaces/{id}/rpc
  B->>G: commit initial snapshot
  G->>A: push via /v1/workspaces/{id}/git/*
  A->>R: proxy smart-HTTP with server-side token

  B->>A: POST /v1/workspaces/{id}/rpc (ApplyArtifactProjectChange)
  A->>D: rewrite → /v1/artifact-project/rpc
  D->>D: transaction: write file:{path}, change:{rev++}
  D-->>B: change response
  B->>G: commit updated snapshot
  G->>A: push via git proxy

  B->>G: deploy pull/apply writes git-backed store
  G->>A: push Pull/Apply Onboarded account commits
  B->>A: replaceFiles mirror → /v1/workspaces/{id}/rpc
  A->>D: DO snapshot matches committed git store
```

---

## Cross-cutting: the agent tool loop (identical in all modes)

The agent is **not** a server-side loop. The browser drives it; only the LLM
call and the store write cross a boundary, and _where_ the store write lands is
the only thing that differs per mode.

```mermaid
sequenceDiagram
  participant UI as Chat panel (browser)
  participant CA as chat adapter
  participant LLM as /v1/chat → OpenRouter
  participant TL as tool loop (browser)
  participant ST as artifact store (mode-dependent)

  UI->>CA: user message
  loop up to 8 rounds
    CA->>LLM: messages + tool defs
    LLM-->>CA: assistant message (+ tool calls)
    alt has tool calls
      CA->>TL: executeSchematicsToolCall(write_artifact_source, ...)
      TL->>ST: write / create / delete
      Note right of ST: memory → in-browser<br/>local → Node FsStore (commits)<br/>hosted → DO RPC + browser git mirror
      ST-->>TL: result + validation
      TL-->>CA: tool result
    else final answer
      CA-->>UI: assistant reply
    end
  end
```

This is why provenance threading matters in the demo plan: the tool loop knows
the turn/tool-call IDs. They become commit trailers in local mode, and hosted
browser commits preserve the same trailer shape when the hosted chat/tool path
applies an agent change. Memory mode remains in-memory revision metadata only.

---

## Cross-cutting: the deploy engine (pull / plan / apply)

The deploy engine (`config-deploy/src/engine.ts`) is the same in every mode; what
changes is _where it runs_ and _which Onboarded API it talks to_.

```mermaid
flowchart LR
  subgraph engine["ConfigDeploy engine"]
    pull["pull: project(remote) → store"]
    plan["plan: diff(remote, store)"]
    apply["apply: reconcile(remote, store)"]
  end
  store["artifact store<br/>(working tree)"]
  remote["Onboarded API"]

  pull --> store
  store --> plan
  plan --> apply
  apply --> remote
  remote --> pull
  remote --> plan
```

- **Local serve:** engine runs **server-side** behind `/v1/deploy/rpc`, holding
  real credentials in a `DeploySecretStore`; the browser only drives it. Talks to
  the live Onboarded HTTP API (or mock).
- **Playground memory:** engine runs **in-browser** against the **mock** API and
  the shared in-memory store — the self-contained demo.
- **Cloudflare hosted:** the playground demo runs **in-browser** against the
  **mock** API, but the store is the hosted browser git store. Pull/apply commits
  are pushed through the worker git proxy and then mirrored back to the hosted
  DO with `replaceFiles`. A production hosted deploy would move credentials and
  the deploy engine server-side.

The `pull ⇄ apply` arrows back to `remote` are the convergence loop formalized in
the e2e-demo plan: a clean working tree makes `pull ∘ apply` identity, which is
why "merge a draft" and "re-pull the account" reach the same fixed point.

---

## Storage & history substrate — side by side

```mermaid
flowchart TB
  subgraph A["Local serve"]
    a1["FsArtifactStore (disk)"] --> a2[".git repo<br/>1 commit / change<br/>trailers: Actor/Turn-Id/Tool-Call-Id"]
  end
  subgraph B["Playground memory"]
    b1["createMemoryArtifactStore"] --> b2["VersionedArtifactStore<br/>in-memory revisions (lost on reload)"]
  end
  subgraph C["Cloudflare hosted"]
    c1["Durable Object storage<br/>file:{path}"] --> c2["change:{rev} changelog<br/>{actor,label,changedPaths}"]
    c1 <--> c3["Browser isomorphic-git clone<br/>Artifacts git repo via proxy"]
  end
```

The throughline of the e2e-demo plan: **collapse these three substrates onto
git** (`GitArtifactStore`, `git-artifacts/src/git-artifact-store.ts`) so history,
provenance, fork, and merge work identically regardless of where the store
physically lives.

---

## See also

- [plan-onboarded-config-e2e-demo.md](./plan-onboarded-config-e2e-demo.md) — the
  demo this topology supports, and the three seams that close the gaps above.
- [git-artifacts-demo.md](./git-artifacts-demo.md) — local vs Cloudflare git
  store runbook.
- [plan-git-artifacts.md](./plan-git-artifacts.md) — the three-layer git store
  (provider · backend · store).
- [plan-config-deploy-ui.md](./plan-config-deploy-ui.md) — the pull/plan/apply UI.
