# Plan: Unified end-to-end demo for `onboarded-config`

This is the runbook _and_ the build plan for one continuous story:

```text
connect to an Onboarded account
  -> pull a live snapshot into a workspace
  -> commit it (git is now the store)
  -> prove git holds the data
  -> agent edits the config
  -> commit the agent turn (with provenance)
  -> validate + re-prove
  -> fork the account into a draft branch ("copy of mina")
  -> agent works the draft
  -> human reviews a diff
  -> merge back into main  ==  re-pull and reconcile  (same fixed point)
```

The goal is to turn the existing infra — git-backed `ArtifactStore`
([plan-git-artifacts.md](./plan-git-artifacts.md)), the
`@schematics/onboarded-config` deploy engine
([plan-onboarded-config.md](./plan-onboarded-config.md)), and the agent toolkit
— into a single demo you can run start-to-finish and point at.

It complements, and does not replace:

- [architecture-deployment-modes.md](./architecture-deployment-modes.md) — the
  detailed topology (mermaid) of how local / playground / Cloudflare modes wire
  services and data; read it alongside this plan.
- [git-artifacts-demo.md](./git-artifacts-demo.md) — the local vs Cloudflare
  git store runbook (the storage substrate this demo sits on).
- [plan-account-config-workspace.md](./plan-account-config-workspace.md) — the
  single-account workspace shape (`account.yaml`, `forms/`, `policies/`, …).
- [plan-config-deploy-ui.md](./plan-config-deploy-ui.md) — the pull/plan/apply
  UI loop this demo drives.

## The thesis

`@schematics/onboarded-config` already models an account as a folder of YAML
(`AccountWorkspaceValue` in `workspace.ts`), and `@schematics/alchemy` already
does **pull → plan → apply** against the Onboarded API (live or mock). Separately,
`git-artifacts` already gives us a commit-on-change store with provenance
trailers. **Nobody has stitched the two together end to end.** When we do, git
stops being a side feature and becomes the store of record for a customer's
configuration — every state in the loop above is a commit, every agent edit is
attributable, and "make a draft and merge it back" becomes a first-class
operation instead of a copy-paste.

---

## What exists vs. what we build

Grounded in the current tree (file references are starting points, not
contracts):

| Capability                                             | Status               | Where                                                                                                                                                                                                                  |
| ------------------------------------------------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connect to account (env + auth)                        | ✅ exists            | `examples/onboarded/src/connection.ts`, `deploy-service.ts` `makeOnboardedDeployService`                                                                                                                               |
| Live HTTP API client + in-memory mock                  | ✅ exists            | `http/onboarded-http-api.ts`, `mock/onboarded-api.ts`, `mock/seed.ts`                                                                                                                                                  |
| Pull snapshot → write config files                     | ✅ exists            | `alchemy/src/engine.ts` `pull` (writes via the artifact store)                                                                                                                                                         |
| Plan / apply / destroy                                 | ✅ exists            | `alchemy/src/engine.ts`; `examples/onboarded/src/deploy.ts` providers                                                                                                                                                  |
| Workspace validation + relations                       | ✅ exists            | `examples/onboarded/src/workspace.ts`, `relations.ts`, `rules.ts`, `validation.ts`                                                                                                                                     |
| Git-backed store (commit/log/head) with trailers       | ✅ exists            | `git-artifacts/src/git-artifact-store.ts` (`commit`, `log`, `head`)                                                                                                                                                    |
| Local commit-on-change (`schematics serve` in a repo)  | ✅ exists            | `cli/src/local-artifact-project-client.ts` (`history = gitCommitter !== null`)                                                                                                                                         |
| Hosted repo provisioned + token returned               | ✅ exists            | `cloudflare/src/git-repos.ts` `provisionWorkspaceRepo`; `worker-runtime.ts` create response                                                                                                                            |
| **Pull writing into a _git_ store (not just FS / DO)** | ✅ local / ❌ hosted | IDE/RPC edits commit locally via `LocalGitCommitter`; `onboarded-deploy pull --commit` creates the local import commit including `config.lock.json`; hosted DO does _not_ commit — see Seam A                          |
| **`GetHistory` / `Log` RPC + history panel**           | ✅ local             | `GetHistory` returns git commits for local git workspaces, including parsed trailers and file changes; non-git/hosted modes return unsupported until their backing stores grow git history                             |
| **Diff-per-revision view**                             | ⚠️ partial           | History entries now include raw file changes and the History panel renders a first revision diff; `alchemy/src/diff.ts` is not yet wired for schema-aware per-resource diffs                                           |
| **`mina` named demo account**                          | ✅ exists            | `seedOnboardedData({ account: "mina" })` and `onboarded-deploy --account mina` produce the named account fixture with custom properties, forms, a policy, and an automation                                            |
| **Agent provenance commit trailers**                   | ✅ local / ❌ hosted | Project/artifact change requests can carry `actor`/`turnId`/`toolCallId`; OpenRouter tool execution passes agent provenance; local git commits write trailers and `git blame` attributes agent edits                   |
| **`fork()` (branch-per-draft) + `merge()`**            | ✅ local / ❌ hosted | `forkLocalGitBranch` / `mergeLocalGitBranch` and `onboarded-deploy fork` / `merge` cover local fast-forward drafts, persisted-mock fixed-point proof, and local drift detection; three-way conflicts and hosted remain |
| **Hosted browser push (worker as git CORS-proxy)**     | ❌ missing           | see Seam A                                                                                                                                                                                                             |

> Correction to earlier framing: there is **no `fork()`** on the store or the
> repo binding today. Local fast-forward fork/merge is now implemented as node
> git helpers plus Onboarded CLI commands; generalized store-level, hosted, and
> conflict-aware merge are still net-new. `GetHistory` is now implemented for
> the local git-backed path.

---

## Three architectural seams

The remaining gaps still reduce to three seams. Build or extend them in this
order; each is independently demoable.

### Seam A — Who commits the files? (close the store loop)

Today the **local IDE/RPC edit** path commits (isomorphic-git over `node:fs`),
but the standalone **deploy CLI** path does not: `onboarded-deploy pull --dir …`
uses `createFsArtifactStore`, writes files, and exits without asking git to
commit. The **hosted** path only provisions a repo and writes files into Durable
Object storage — nothing pushes. Two sub-cases:

- **Local (small build):** `onboarded-deploy pull --commit` writes the snapshot
  and creates an intentional git import commit via `LocalGitCommitter`, including
  the persisted `config.lock.json`.
- **Hosted (build):** the worker can't run git (pulls `isomorphic-git`/`crc-32`
  into the bundle, which broke the deploy). The clean seam, unchanged from the
  original analysis:
  - **Browser** runs `isomorphic-git` over the in-memory FS (`mem-fs.ts`):
    clone → stage current files → commit (with `Actor`/`Turn-Id` trailers) →
    push.
  - **Worker** becomes a thin authenticating git **CORS-proxy**: forwards
    smart-HTTP bytes to the Artifacts remote and injects the scoped token
    server-side. No git logic in the worker; the token never reaches the
    browser. (Browsers can't push to git hosts directly and isomorphic-git
    needs a CORS proxy anyway, so this falls out naturally.)

**Deliverable:** a `commit-on-pull` and `commit-on-change` path that is
identical in shape locally and hosted, so the rest of the demo is
backend-agnostic.

### Seam B — Make git visible (history RPC + panel)

`features.history` is in the protocol, and the local git-backed path now has a
history RPC and UI. The remaining work is to make the capability explicit enough
for non-git and hosted stores:

1. **`GetHistory` RPC** in `SchematicsArtifactProjectRpcGroup`
   (`protocol/src/artifact-project.ts`) returns the commit list (`oid`,
   `message`, parsed `Actor`/`Turn-Id`/`Tool-Call-Id` trailers, author,
   timestamp) for local git workspaces.
2. **Server handler** in `server/src/artifact-project-rpc.ts` delegates to the
   local project client's git history adapter. Hosted DO currently returns
   unsupported until it has a git-backed commit path.
3. **History panel** in the React surface renders a version timeline; click a
   revision to inspect it.
4. **Diff view** shows raw git file changes today. A future schema-aware view
   can reuse `alchemy/src/diff.ts` for parsed resources while keeping raw file
   diffs for lockfiles and other non-config files.

This is on for the **local CLI first** — it commits IDE/RPC edits and sets
`history: true` when the served directory is inside a git repo — so you get a
working timeline against a local git repo with zero cloud dependency. The
import/pull commit is the extra local seam from Seam A.

### Seam C — Fork & merge (the "copy of mina" story)

This is the headline. Model it on top of git branches, _not_ a new abstraction:

- **`fork(name)`** → create a branch (`refs/heads/draft/<name>`) from the
  current HEAD and return a `GitArtifactStore` bound to it (the `branch` option
  already exists per-store; fork is "create branch + open store on it"). The
  local CLI slice now exposes this as `onboarded-deploy fork --branch <name>`.
- **Agent works the draft store** — same toolkit, commits land on the branch.
  The local filesystem committer now follows the checked-out branch at commit
  and history-read time unless a branch is explicitly pinned.
- **`diff(base, draft)`** → reuse the diff infra for human review.
- **`merge(draft → main)`** → fast-forward or three-way merge the branch back.
  The local CLI slice starts with fast-forward-only
  `onboarded-deploy merge --branch <name>`.

And the convergence property below makes `merge` and `re-pull` two routes to the
same state.

---

## The fork/merge ⇄ re-pull equivalence (formalize this)

The user's instinct — _"merge via git or rerun pull; they should be the same
thing"_ — is a real fixed-point property worth stating explicitly, because it
tells us when the demo is correct:

```text
Let  L  = local workspace (a git ref)
     R  = the live Onboarded account (remote truth)

pull:   L  := project(R)              // engine.pull writes R's snapshot into L
apply:  R  := reconcile(R, L)         // engine.apply pushes L's changes to R
plan:   diff(R, L)                    // what apply would do

A draft is a branch L' forked from L. The agent mutates L' -> L''.
```

There are then **two ways to land a draft**, and they converge:

1. **Git route:** `merge(L'' → L)`. Main now equals the draft. To make the
   _account_ match, you still run `apply` (plan/apply pushes L to R).
2. **Reconcile route:** `apply(L'')` directly (push the draft to R), then
   `pull` into L. Now `L == project(R) == project(reconcile(R, L''))`.

These reach the **same fixed point** exactly when the draft was the only writer
— i.e. `pull ∘ apply` is identity on a clean draft. The demo proves this: after
either route, a fresh `pull` produces **no plan changes** and the git tree of
`main` matches the re-pulled tree. That "empty plan after merge" is the
acceptance test for the whole loop.

Where they _diverge_ is the interesting product surface:

- If R changed underneath (someone else edited the account), `re-pull` surfaces
  it as a plan, and `merge` surfaces it as a git conflict — same information,
  two presentations. The local demo now shows the first presentation: a
  persisted mock remote drifts after fork but before merge, and `plan` surfaces
  the update before the fast-forward merge.

---

## Demo phases (smallest-first, each independently shippable)

Each phase is a checkpoint you can stop at and show.

### Phase 0 — `mina`, a named demo account

Replace/extend the anonymous "Demo Staffing" seed (`mock/seed.ts`) with a
richer, named **`mina`** account: a few custom properties, 2–3 forms, a policy
that references them, an automation. This is the fixture every later phase pulls
from, so it must exercise cross-references (forms → properties, policy → forms)
to make validation and diff meaningful.

- **Backend:** mock API (no cloud). **Show:** either make the default mock seed
  be `mina` or add an explicit account selector such as
  `seedOnboardedData({ account: "mina" })`. `seedOnboardedData('mina')` and
  `onboarded-deploy --account mina` do not exist today.

### Phase 1 — Connect + pull + commit (local, mock API)

Drive the existing engine end to end into a git repo on disk. The local
`--commit` option closes Seam A for this mode: pull writes files and then creates
the import commit in the same repo.

```bash
mkdir mina-config && cd mina-config && git init
# pull the mock account snapshot and create the import commit
onboarded-deploy pull --dir . --account mina --commit  # writes account.yaml, forms/*, config.lock.json, ...
onboarded-config web --dir .                        # history capability ON (git repo)
```

- **Prove git has the data:** `git log --oneline` shows the pull commit;
  `git show HEAD:account.yaml` returns the snapshot; `git cat-file -p` round-trips.
- **Acceptance:** `onboarded-deploy plan --dir .` is empty (local == remote).

> Local target behavior is implemented by `onboarded-deploy pull --commit`.
> Hosted still needs the browser/worker commit seam from Seam A.

### Phase 2 — History RPC + panel (Seam B)

Surface what Phase 1 produced in the playground UI.

- `GetHistory`, a local server handler over the actual local git history
  adapter, the timeline panel, and a raw per-revision file diff are implemented.
  A schema-aware resource diff can still reuse `alchemy/src/diff.ts` for
  parsed YAML values; keep raw file diff for `config.lock.json` and other
  non-config files.
- **Show:** open `mina-config` in the IDE → History panel lists the pull commit
  → click it → diff shows the full add.

### Phase 3 — Agent edits + provenance commit

Let the agent change the config and prove attribution.

- Agent uses `write_artifact_source` (`packages/agent/src/artifact-toolkit.ts`)
  to, e.g., add a field to a form or tighten a policy rule.
- The change commits with `Actor: agent`, `Turn-Id`, `Tool-Call-Id` trailers.
  `ArtifactProjectChangeRequest` and `ArtifactChangeRequest` now carry optional
  provenance metadata, OpenRouter tool execution passes
  `{ actor: "agent", turnId, toolCallId }`, and the local `LocalGitCommitter` path writes those
  trailers into commits. Hosted still needs the same metadata threaded through
  its eventual git commit path.
- The local walkthrough uses a deterministic scripted debug OpenRouter response
  so it exercises the real chat/tool/runtime path without requiring network or
  model credentials.
- **Prove:** `git log` shows the agent commit;
  `git blame forms/<form>.yaml` attributes the new field to the agent turn;
  the History panel shows actor = agent.
- **Validate:** `validate_artifact_project` runs clean (or the agent is shown
  fixing a diagnostic it introduced).

### Phase 4 — Fork → agent draft → review → merge (Seam C)

The full "copy of mina" story.

```text
fork mina  ->  branch draft/mina-q3
agent works the draft (several commits)
human opens diff(main, draft/mina-q3) in the History/diff panel
review -> merge draft/mina-q3 into main
```

- **Prove convergence:** after merge, `onboarded-deploy plan` against the
  account is empty _iff_ the draft was also applied; show both the git route and
  the re-pull route landing on the same tree (the acceptance test from the
  equivalence section).
- **Show drift:** mutate the account out-of-band before merge → `plan` (or merge)
  surfaces the conflict.

> Local status: `e2e-fork-merge.spec.ts` now proves fork → scripted agent draft
> commit → review diff → fast-forward merge back to `main`, with git assertions
> that `main` was unchanged until merge and equals the draft head after merge.
> It mutates a persisted Mina mock remote out-of-band and captures
> `03b-drift-detected` when pre-merge `plan` surfaces the update. It also
> applies the merged main tree into that mock remote via
> `onboarded-deploy --mock-state`, re-runs `plan` in a fresh CLI process, and
> captures `05-empty-plan-after-merge` when the plan is empty.

### Phase 5 — Hosted parity (Seam A, hosted case)

Make the identical loop run in the playground against a Cloudflare-provisioned
repo: browser-side isomorphic-git push through the worker CORS-proxy. Same UI,
same phases — only the provider + FS differ (exactly the local/Cloudflare split
already documented in [git-artifacts-demo.md](./git-artifacts-demo.md)).

---

## E2E tests & screenshots are the deliverable

Every phase above lands with a **Playwright walkthrough spec** that drives the
real UI and captures **captioned screenshots**. The screenshots are not an
afterthought — they _are_ the acceptance artifact: a phase is "done" when its
spec passes and its screenshot baselines are committed. This also gives us a
visual changelog of the demo as it grows, and doc-ready imagery.

### Reuse the harness that already exists

The playground already has exactly the right rig (`apps/playground/`):

- **Runner:** `playwright.config.ts` — chromium, 1600×1000, snapshots under
  `tests/__screenshots__/{specPath}/`, `pnpm playground:e2e` (root) /
  `pnpm test:e2e` (app); refresh baselines with `pnpm playground:e2e:update`.
- **Captioned capture:** `tests/support/walkthrough.ts` — `createWalkthrough(testInfo)`
  returns `.capture(page, name, { caption })`, which asserts
  `toHaveScreenshot(name.png)` _and_ writes a `captions.json` (title + body per
  shot). This is the pattern to copy verbatim.
- **Servers under test:** the config already boots two — the memory-mode SPA
  (`:4318`) and the **local-filesystem** onboarded-config CLI
  (`onboarded-config … web --dir … :4319`). The local-git demo adds a third (see
  below). Existing precedent: `tests/app/onboarded-config-binary.spec.ts` already
  drives the `:4319` filesystem workspace and captures 12 preview screenshots.

> **Determinism:** the local-git fixture pins the import and scripted agent
> commit author/committer dates from `E2E_NOW` so Phase 1-3 screenshots are
> stable today. The broader cleanup is still to inject clock / id-source as
> **Effect services** so commit time, author, and ids are deterministic by
> construction across local, agent, and hosted paths.

### A third `webServer`: the git-backed workspace

The `:4320` `webServer` entry serves a **git-initialized** onboarded-config
workspace so the history/fork/merge phases have a real repo to render:

```text
command: run a setup script that creates a stable temp repo, runs onboarded-deploy pull --commit,
         writes the repo path to
         a known file/env location, then starts `onboarded-config web --dir <repo>`
url:     http://127.0.0.1:4320
```

The specs assert both **UI state** (History panel rows) _and_ **git ground
truth** by shelling out (`git -C <repo> log --format=…`) inside the test — the
two must agree. That dual assertion is what proves "git actually has the data,"
not just "the UI drew something." The repo path is written to
`tmp/onboarded-git-workspace.json` so specs can read it without depending on
Playwright's process environment.

### Per-phase spec + screenshot manifest

| Phase                     | Spec file (new)             | Server        | Key screenshots (captioned)                                                                                                |
| ------------------------- | --------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 0 `mina` fixture          | `mina-fixture.spec.ts`      | :4319         | `01-mina-account`, `02-mina-forms`, `03-mina-policy`                                                                       |
| 1 connect→pull→commit     | `e2e-pull-commit.spec.ts`   | :4320 (git)   | `01-empty-workspace`, `02-pull-running`, `03-pulled-tree`, `04-git-log-proof`                                              |
| 2 history + diff          | `e2e-history-panel.spec.ts` | :4320 (git)   | `01-history-timeline`, `02-revision-selected`, `03-revision-diff`                                                          |
| 3 agent edit + provenance | `e2e-agent-commit.spec.ts`  | :4320 (git)   | `01-agent-prompt`, `02-agent-edit-applied`, `03-commit-actor-agent`, `04-blame-attribution`                                |
| 4 fork→review→merge       | `e2e-fork-merge.spec.ts`    | :4320 (git)   | `01-fork-created`, `02-draft-edits`, `03-review-diff`, `03b-drift-detected`, `04-merged-main`, `05-empty-plan-after-merge` |
| 5 hosted parity           | `e2e-hosted.spec.ts`        | hosted worker | `01-create-workspace`, `02-edit-committed`, `03-hosted-history`                                                            |

`05-empty-plan-after-merge` is the visual form of the convergence acceptance test
from the equivalence section — a screenshot of an empty plan _is_ the proof that
merge and re-pull reached the same fixed point.

### Agent specs

Phase 3/4 specs drive the agent. Phase 3 uses the **debug OpenRouter client**
with `SCHEMATICS_E2E_SCRIPTED_AGENT=1`, which returns a deterministic
`write_artifact_source` call followed by `validate_artifact_project`. The `:4318`
server already runs with a mock API base
(`VITE_SCHEMATICS_API_BASE_URL=/__schematics_e2e__`), which is the pattern to
extend for future hosted or agent fixtures.

---

## How this serves the broader vision

Same payoffs as the original analysis, now with phase numbers attached:

- **Durable, inspectable history** (Phase 2) replaces the ephemeral in-memory
  `VersionedArtifactStore` revisions — reload-safe, undo/redo become ref moves.
- **Agent provenance** (Phase 3) — `git blame` a schema change to the exact
  agent turn via trailers.
- **Branch-per-proposal** (Phase 4) — an agent proposes config on a branch; a
  human reviews a diff and merges; `alchemy` plan/apply runs against a
  _committed_ revision, not live state.
- **Forking / templates / sharing** — "duplicate this workspace" is a git fork
  (Phase 4 generalizes to templates).
- **Blobs** ([plan-blob-artifacts.md](./plan-blob-artifacts.md)) — assets live
  content-addressed in the same repo (`GitBlobArtifactRef`).

---

## Open questions / risks

1. **Hosted commit-on-pull is not implemented.** Local `onboarded-deploy pull
--commit` creates the import commit, but hosted still needs the browser-side
   git push through a worker CORS-proxy. (Seam A, hosted.)
2. **Merge semantics in isomorphic-git.** Local fast-forward merge and
   pre-merge drift detection are implemented; three-way merge + git conflict
   surfacing is the remaining work in Seam C.
3. **Hosted trailer threading.** Local agent/tool changes carry provenance into
   git commits, but hosted still needs the same metadata attached to browser-side
   commits once the worker CORS-proxy push path exists.
4. **Lockfile across branches.** `config.lock.json` maps slugs ↔ remote ids.
   Forks share it; confirm a draft branch doesn't desync the lockfile from the
   account it will eventually apply to.
5. **Convergence guarantee.** The "empty plan after merge" acceptance test only
   holds if `pull ∘ apply` is identity for the config kinds in play. Account is
   read-only; automations are import-only (`deploy.ts`) — verify those don't
   produce phantom plan diffs.

---

## First PR / current local slice

**Phases 1-4 against the local git path**, seeded by Phase 0's `mina` fixture.
It's the highest-signal slice: it makes the pull → commit → _see it in the UI_
loop real with zero cloud dependency, then proves agent attribution through git
trailers and blame. The Phase 4 local slice proves fast-forward branch-per-draft
and the empty-plan fixed point against a persisted mock remote; the remaining
layers are conflict/drift surfacing and hosted parity.

Scope of that PR concretely:

1. Phase 0 `mina` seed, including either a real account selector API or making
   `mina` the default mock account.
2. The local history substrate: `GetHistory` RPC plus a local handler backed by
   the current local git mechanism (or a refactor that makes the local service
   use a shared git history adapter).
3. The `:4320` git-backed `webServer` setup script with a deterministic repo
   path and an import commit created by `onboarded-deploy pull --commit`.
4. History panel and first diff view (Phase 2).
5. Local scripted agent provenance path (Phase 3), including trailers and blame
   attribution.
6. Local fast-forward fork/merge path (Phase 4), including branch-following
   commits, `onboarded-deploy fork` / `merge`, and persisted-mock empty-plan
   proof.
7. The `e2e-pull-commit.spec.ts`, `e2e-history-panel.spec.ts`,
   `e2e-agent-commit.spec.ts`, and `e2e-fork-merge.spec.ts` walkthroughs with
   committed screenshot baselines and `captions.json` — the visible acceptance
   artifact for the PR.
