# Analysis: the agent-factory vision versus Schematics today

Status: **product and implementation comparison**, November 5, 2026.
Repository baseline: `994f80628971f416c1c26a7194cb6cf997feff0d`.
This is a source/document audit, not evidence of a newly deployed service.
“Built” below means an implementation is present in this checkout; account-backed
Cloudflare behavior still needs integration verification.

The input is the owner's November 5 vision conversation and the request for a
Cloudflare-hosted, Alchemy-deployed factory. Its requirements are restated here
so the analysis remains useful without the workspace attachment. The companion
[Cloudflare factory plan](./plan-cloudflare-agent-factory.md) covers recommended
infrastructure, API contracts, recovery, costs, environments, and delivery gates.

## Finding

**The repository is a substantial configuration editor and external-resource
reconciliation toolkit, with real Git and Cloudflare foundations. The vision is
a durable, collaborative agent factory built around configuration repositories
and drafts.** They are compatible layers, but they are different product centers.

The gap is more than UI terminology or a different hosting provider. Instances,
durable drafts, server-owned agent runs, revision-bound review, and serialized
merges need application services that do not exist yet. Existing source editing,
diagnostics, model/tool adapters, Git plumbing, and deployment infrastructure can
support those services.

Two positioning decisions also need explicit resolution. Current docs make
Forma optional, and describe Open Ontology as an independent workflow product.
The vision makes Forma the first supported language and Open Ontology a reusable
domain-package ecosystem. Neither of those new product assumptions is implemented
or established by the current dependency graph.

## The vision being compared

The product thesis is an agentic configuration factory for software-defined
businesses. A factory manages many instances; each instance owns persistent
Git-tracked configuration and outlives individual chats, agents, and sandboxes.
Forma is the initial authoring language, while language-independent draft APIs
leave room for other configuration systems later.

The agreed MVP in the conversation is:

1. A user chooses an instance and creates a draft from canonical main.
2. The draft owns a branch, durable conversation, multiple finite agent runs,
   checks, comments, and review state.
3. An isolated agent makes edits, invokes Forma checks, and publishes a
   Git-tracked revision without modifying canonical main.
4. Humans inspect source changes and diagnostics. Another human or a read-only
   agent can review the exact revision and leave comments or request changes.
5. Merge requires current checks, required approvals, no blocking discussion,
   and validation of the candidate against current main. Concurrent drafts must
   not overwrite each other.
6. Web UI, CLI, REST, and external agents share the same services. An
   instance-scoped MCP supports create → prompt → wait → inspect → submit, with
   merge separately authorized. Waiting returns a durable settled result or an
   input request, not merely the end of an HTTP response.

The added infrastructure requirement is Cloudflare Artifacts for Git, Workers for
hosting, Sandbox for execution, potentially AI Gateway/Workers AI for models,
and Alchemy provisioning with local development, remote dev, and PR previews.

The conversation defers live SaaS deployment, generalized synchronization,
complex policy engines, semantic diffs, visual designers, multi-agent swarms, and
direct external-agent editing. It suggests Postgres as a possible metadata store;
that is an implementation suggestion, not a prerequisite for the product loop.
The continuous-conversation-versus-independent-runs question was left open.

## What the repository currently articulates

| Source                                                                          | Present product claim                                                                                           | Difference from the brief                                                                                      |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [README](../README.md)                                                          | Effect-native config-as-code control plane for APIs and SaaS resources                                          | Provider/reconciliation lifecycle is the center, rather than an instance/draft factory                         |
| [Constellation architecture](./architecture-constellation.md)                   | Schematics owns providers, declarations, plans, review, apply and drift; Triplex persistence is planned         | No factory-level draft/run/review model; planned definition persistence has a different scope from Git history |
| [Deployment modes](./architecture-deployment-modes.md)                          | Local filesystem, in-memory playground, and hosted workspace modes sharing document RPC and a browser tool loop | Hosted workspace is a file service, not a durable collaborative instance with isolated draft execution         |
| [Provider DSL guide](./provider-dsl-providers.md)                               | `defineResource` and `defineProvider` derive schemas, projects, mocks, reconciler and CLI                       | Strong domain integration layer, but not a Forma package/DSL ecosystem                                         |
| [Consumption guide](./consuming-schematics.md)                                  | Private workspace packages consumed by downstream CLI/frontend products                                         | Embeddable toolkit distribution rather than a multi-tenant hosted factory product                              |
| [Git plan](./plan-git-artifacts.md) and [demo runbook](./git-artifacts-demo.md) | Git-backed artifact store, per-workspace Artifacts repos, commit provenance, local/hosted history               | Foundation for versioning, without complete draft collaboration or merge policy                                |
| [Public agent entry point](../apps/playground/public/llms.txt)                  | Editor, validation, patch review, provider pull/plan/apply; family libraries and future persistence             | Correctly emphasizes current functionality, not the proposed factory                                           |

The README lifecycle is `provider → observations → declarations → plan → review
→ apply → new observations`. The factory lifecycle would be `instance → draft →
run → committed revision → checks → review → merge`. They can compose: an approved
canonical configuration can later produce a provider plan. A plan approval and a
source-branch approval are different records and permission boundaries.

## Capability comparison: documented, built, and missing

**Built** means concrete code exists; **partial** means useful mechanisms exist
without the product contract; **planned** means an explicit future direction;
**missing** means no corresponding factory implementation was found in the
reviewed source and package manifests. Similar words in demos or other subsystems
do not establish the capability.

| Vision requirement                           | Current articulation                                         | Implementation evidence                                                                                                                                             | Assessment and next work                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Effect-native architecture                   | Core convention                                              | Workspace packages use Effect 4.1.1; [workspace versions](../pnpm-workspace.yaml)                                                                                   | **Built.** Retain typed services and dependency boundaries                                                       |
| Many persistent configuration instances      | Flavors, artifact projects, hosted workspaces                | [Workspace object](../packages/cloudflare/src/workspace-object.ts), [hosted router](../packages/cloudflare/src/worker-runtime.ts)                                   | **Partial.** Add tenant-owned instances, repository identity and lifecycle                                       |
| One authoritative Git repo per instance      | Per-workspace Git history                                    | [Repo provisioning](../packages/cloudflare/src/git-repos.ts), [Git store](../packages/git-artifacts/src/git-artifact-store.ts)                                      | **Partial.** Current files are DO-authoritative; Git is a browser-maintained mirror                              |
| Draft as a durable collaborative object      | Branch/fork demonstration                                    | [Hosted Git helper](../apps/playground/src/hosted-git.ts), [playground UI](../apps/playground/src/PlaygroundApp.tsx)                                                | **Partial.** No durable title/author/status/thread/check/review aggregate                                        |
| Isolated branches and workspaces per draft   | Local branches and hosted branch selection                   | [Git backend](../packages/git-artifacts/src/git-repo-backend.ts), shared hosted workspace snapshot                                                                  | **Partial.** A branch name does not isolate the hosted DO's file state or execution                              |
| Server-run coding agent                      | Browser chat and tool loop                                   | [Chat runtime](../packages/agent/src/openrouter-proxy-runtime.ts), [chat panel state](../packages/ide/src/SchematicsChatPanel.tsx)                                  | **Missing factory runner.** Add durable start/cancel/deadline/recovery independent of UI                         |
| Model-independent execution                  | Small swappable chat adapter; OpenRouter and debug responder | [Agent types](../packages/agent/src/types.ts), [language-model layer](../packages/agent/src/openrouter-language-model.ts)                                           | **Partial.** Useful port; add server-run persistence and a tested Gateway adapter                                |
| Durable conversation and run history         | Editor timeline and change provenance                        | Chat panel's in-memory reactive history; commit trailers                                                                                                            | **Missing factory persistence.** Git metadata does not reconstruct full messages/tool results                    |
| Forma-first authoring and checks             | Forma optional in family docs                                | [Document codecs](../packages/core/src/document-codec.ts) and [protocol formats](../packages/protocol/src/artifact-project.ts) support JSON/YAML                    | **Missing.** Add a real compiler/package/check adapter; preserve existing formats                                |
| Reusable Open Ontology packages              | Described as a potential consuming workflow product          | No package registry/resolver integration in reviewed runtime manifests                                                                                              | **Missing / positioning conflict.** Verify ecosystem and package contract                                        |
| Schema validation and cross-file diagnostics | Central existing feature                                     | [Artifact validation](../packages/core/src/artifact-project-validation.ts), [source maps](../packages/core/src/source-map.ts)                                       | **Built for current documents.** Add commit-bound check records and Forma diagnostics                            |
| Reviewable source changes                    | Patch proposals, Git history/diffs and deploy plans          | [Artifact-project view](../packages/ide/src/SchematicsArtifactProjectView.tsx), [deploy changes panel](../packages/ide/src/SchematicsDeployChangesPanel.tsx)        | **Built mechanisms.** Adapt into draft revision review UI                                                        |
| PR-style comments and human approvals        | General “human and agent review” language                    | Plan-mode `propose_patch`, deploy approval flows                                                                                                                    | **Missing durable draft review.** Add reviewers, decisions, threads, blocking resolution and stale approvals     |
| Optional read-only reviewer agent            | Plan-mode tools can be restricted                            | [Tool mode enforcement](../packages/agent/src/schematics-toolkit.ts)                                                                                                | **Partial.** Enforce reviewer identity/capabilities and bind findings to SHA                                     |
| Safe merge against latest main               | Fork/merge walkthroughs                                      | Backend implements fast-forward-only merge and rejects divergence                                                                                                   | **Partial.** Add current-main candidate checks, authorization, locking, conditional remote update and recovery   |
| REST factory API                             | Effect HTTP chat API plus document/deploy/workflow RPC       | [HTTP API](../packages/protocol/src/http-api.ts), [artifact-project RPC](../packages/protocol/src/artifact-project.ts), [app wiring](../packages/server/src/app.ts) | **Missing factory resources.** Current `/v1` prefix does not implement proposed `/instances`, `/drafts`, `/runs` |
| Instance-scoped remote MCP                   | Internal typed tools for Schematics' own agent               | No MCP server implementation/dependency found in reviewed application packages                                                                                      | **Missing.** Internal tools are reusable implementations, not an external MCP endpoint                           |
| Wait until a run settles                     | Local promise/cancel and subsystem events                    | Chat handle, document watch events; deploy/ingest have their own run/event contracts                                                                                | **Missing factory semantics.** Persist final SHA/disposition, check completion, cursors and bounded waits        |
| Multi-user permissions and tenants           | Not the hosted demo's product contract                       | Hosted routes accept IDs and proxy tokens without principal/membership checks                                                                                       | **Missing at factory boundary.** Add identity, roles, capability grants and per-call authorization               |
| Cloudflare-hosted frontend/API               | Documented and configured                                    | [Stack](../alchemy.run.ts), [Worker runtime](../alchemy/schematics-api-worker-runtime.ts)                                                                           | **Built wiring.** Extend rather than replace                                                                     |
| Cloudflare Artifacts Git                     | Documented; optional binding at runtime                      | Worker binding/proxy plus Git clients and tests                                                                                                                     | **Built integration.** Prove publication/concurrency guarantees needed by the new authority model                |
| Cloudflare Sandbox execution                 | Not in current application topology                          | No Sandbox runner or container image in the application                                                                                                             | **Missing.** Alchemy dependency supporting Containers is not deployed agent execution                            |
| Cloudflare model routing                     | OpenRouter currently configured                              | [API resource](../alchemy/schematics-api-worker.ts), [server client](../packages/server/src/openrouter-client.ts)                                                   | **Missing.** Add Gateway/Workers AI options without making every model mandatory                                 |
| Alchemy dev/PR/prod infrastructure           | Existing Cloudflare deployments                              | Production, preview and cleanup [workflows](../.github/workflows/)                                                                                                  | **Partial for full factory.** Existing previews cover current resources, not future metadata/sandboxes/auth      |
| External-resource apply and drift            | Core present lifecycle                                       | [Reconciliation engine](../packages/alchemy/src/engine.ts), provider/deploy packages                                                                                | **Built and beyond factory MVP.** Retain as a later stage; merge must not imply apply                            |
| Triplex definitions/releases/observations    | Explicit future direction                                    | No shipped Triplex adapter                                                                                                                                          | **Planned.** Decide semantic-store boundary separately from operational factory metadata                         |

### The most consequential implementation differences

#### Git is a mirror of hosted files today

`SchematicsWorkspaceObject` persists `file:<path>` entries, workspace metadata,
and numeric change revisions in DO storage. Its RPC services operate on that
state. `withHostedGitCommits` calls the workspace change first, then commits the
resulting snapshot in the browser. Its commit failure handler logs a warning and
returns `null`; it does not roll back the file edit.

This works as a hosted editing/history demo. It does not provide the vision's
invariant that every authoritative configuration change is a durable Git
revision. A factory needs publication status and recovery after a successful Git
push with a lost acknowledgement, as well as after a failed push. A successful
workspace RPC cannot stand in for a confirmed source revision.

#### Draft branches do exist, but draft isolation does not

The hosted playground has “Fork draft” and “Merge draft” actions using the
scripted branch `draft/q3-refresh`. This is real branch plumbing, not merely a
visual mock. However, the hosted RPC still addresses one workspace DO; its
metadata and file keys have no draft/branch partition. Browser-selected branch
state therefore does not establish independent durable working trees for two
simultaneous drafts.

The [backend merge implementation](../packages/git-artifacts/src/git-repo-backend.ts)
allows fast-forwards and rejects diverged histories. That is useful protection
for a demo, but it does not validate a merge candidate against new main, collect
revision-bound approvals, or coordinate a server-authorized merge. Reuse the Git
mechanisms while adding the missing application contract.

#### The agent is driven by the client

The chat adapter executes up to eight model/tool rounds per send, forwarding
model requests to the API and executing tools through the supplied host runtime.
The React chat panel owns an in-memory history/timeline store. This separates
model transport from tools well, but it does not provide a durable agent job that
an external caller can start and later query after the browser closes.

Move the reusable loop and tools into a sandbox-compatible runner. Record each
run's input SHA, triggering message/history boundary, selected model, attempt,
output disposition, events, and checks. Keep the UI a client of that lifecycle.

#### “Review” currently covers different operations

Plan-mode patch approval and provider-plan review are real features. They answer
whether a proposed edit should land or external mutations should apply. The
vision additionally needs a durable review of a particular draft SHA: who
approved it, which comments block it, which approvals became stale, and whether
the candidate still passes against current main.

Do not discard existing review UI, but do not describe it as a complete PR-style
collaboration backend. A reviewer agent also needs enforced read-only permissions,
not only a different instruction prompt.

#### Current credential hiding does not establish authorization

The hosted Git proxy correctly keeps raw Artifacts credentials out of browser
responses. It nevertheless selects read/write credentials from the Git request
and forwards traffic without tenant/principal authorization. The hosted RPC
router similarly uses workspace IDs without a membership gate. Wildcard CORS is
not an authorization system, and keeping a repo token server-side does not stop
an authorized proxy path from being used to update main.

Factory services must authorize instance access, writes, review, and merge.
The proposed publication design deliberately keeps repo-wide write capability
out of agent-controlled execution. This is a concrete boundary required by the
multi-user vision, not a request to add production auth to an unrelated demo.

## Product and vocabulary decisions

| Decision                   | Vision                                            | Current repo                                                    | Recommended resolution                                                                                                     |
| -------------------------- | ------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Schematics' product center | Git-backed agentic configuration factory          | External-resource management toolkit/control plane              | Add the factory application above reusable document/provider packages; decide positioning before changing the public pitch |
| Forma                      | First-class initial authoring language            | Optional authoring direction; JSON/YAML shipped                 | Make Forma an explicit new integration milestone; do not rename JSON/YAML validation as Forma support                      |
| Open Ontology              | Ecosystem of reusable domain packages             | Independent operational workflow product and potential consumer | Confirm ownership/registry contract; keep Schematics free of host imports and private dependencies                         |
| Instance                   | Persistent repository and canonical configuration | “Instance” may also mean a downstream product/flavor            | Reserve factory instance for a tenant-owned repo; a provider/flavor selects capabilities, not tenancy                      |
| Draft                      | Durable proposed change backed by branch          | Branch action or editor draft text                              | Introduce a distinct aggregate; a branch is one part of it                                                                 |
| Workspace                  | Disposable checkout/runtime                       | Durable document project/hosted DO                              | Preserve compatibility API; use explicit factory execution-workspace terminology at new boundaries                         |
| Thread/run                 | Persistent history plus finite executions         | Client chat turn and local handle                               | Recommend finite runs over one durable draft conversation; keep provider sessions optional                                 |
| Check                      | Compiler/validator result against revision        | Continuously computed document reflection                       | Persist check basis and outcome while keeping live reflection for editing                                                  |
| Review                     | Comments/approval against exact source revision   | Patch/plan inspection and approval                              | Support both with distinct records and authority                                                                           |
| Release/deployment         | Later apply to external systems                   | Reconciliation is already central; Triplex releases planned     | Distinguish source merge, desired release and external apply; avoid silently replacing planned release semantics           |
| Artifact                   | General files in historical implementation        | New public meaning is published output                          | Keep Cloudflare **Artifacts** as the vendor Git product name; preserve `ArtifactProject` until a deliberate migration      |
| Alchemy                    | Infrastructure deployment                         | Both upstream `alchemy` and local `@schematics/alchemy`         | Always identify which one: infrastructure provisioner versus resource reconciler                                           |

The language-independent factory contract is useful even with Forma first.
Existing JSON/YAML providers remain valuable fixtures and consumers. Schema
Reflection continues to own neutral inspectable schema primitives; Forma owns
language semantics; Schematics owns change management and external providers.
WorldVM's durable business execution remains a different responsibility from
running a configuration-authoring job.

## Documentation inconsistencies found during the audit

These are follow-up corrections, not proof that a planned feature shipped:

- The [deployment-modes guide](./architecture-deployment-modes.md) links to
  `plan-onboarded-config-e2e-demo.md`, which is absent, and contains historical
  `onboarded-config` / `makeOnboardedDeployService` / `config-deploy/src/engine.ts`
  references. The current public examples include toy and catalog, and the
  reconciler lives under `packages/alchemy`. Its major browser/DO/Git topology
  remains informative, but old file/line references are not reliable anchors.
- The [Git plan](./plan-git-artifacts.md) labels its three layers implemented but
  retains earlier discussion of Worker Git and follow-up browser commits. The
  current hosted helper already performs browser-side commit/push and branch
  actions. Treat the implementation and demo tests as the stronger evidence.
- The [Git demo runbook](./git-artifacts-demo.md) emphasizes token privacy and
  says server-side commits are absent. Clarify in a later update that the
  limitation is the current Worker implementation, not a prohibition against
  native Git in a future server-controlled sandbox.
- [Parser planning](./plan-parser.md) describes source mapping as future work,
  while the JSON/YAML codecs and `source-map.ts` already implement mapped parsing.
  Audit its status before treating all unchecked historical plan text as backlog.
- [Standalone extraction](./plan-standalone-schematics.md) and
  [rename planning](./plan-schematics.md) preserve historical host names and
  deployment/publication assumptions. Their checklists are not the current
  product specification.
- The public agent entry point correctly labels Triplex/WorldVM integration and
  broader library adoption as future work. Keep that discipline for factory,
  Forma, Sandbox, and MCP claims too.

This change adds discoverable analysis/plan links. It intentionally leaves those
broader historical-doc rewrites as identified work, so it does not silently
promote the factory proposal into current architecture.

## What to retain, extend, and add

| Treatment | Components                                                                         | Rationale                                                                                          |
| --------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Retain    | Effect services, schema reflection, source-mapped diagnostics, relation validation | Existing correctness and introspection foundation                                                  |
| Retain    | Provider DSL, mocks, pull/plan/apply, lockfile identity                            | Useful domain integrations and later deployment stage                                              |
| Retain    | IDE, CodeMirror, forms/previews, history and diff rendering                        | Reusable surfaces inside a draft review product                                                    |
| Retain    | Artifacts provisioning/proxy concepts, Git backend and provenance                  | Useful ports and tested Git primitives                                                             |
| Retain    | Alchemy stack, production gating, PR stage naming and cleanup workflow             | Existing deployment foundation                                                                     |
| Extend    | Model/tool interfaces                                                              | Execute in a supervised server sandbox and support Gateway without coupling the factory to a model |
| Extend    | Document/RPC adapters                                                              | Address an authorized draft revision and route writes through the common publication contract      |
| Extend    | Hosted Git ownership                                                               | Server-authoritative commits and recoverable operations; browser becomes a client/cache            |
| Add       | Factory domain services and operational persistence                                | Instance/draft/message/run/check/review/merge records and invariants                               |
| Add       | Sandbox executor, trusted publisher, validator runner                              | Disposable execution with controlled write authority and durable results                           |
| Add       | REST factory API and instance-scoped MCP                                           | Equivalent UI/CLI/external-agent workflows                                                         |
| Add       | Identity, tenancy, roles, quotas and durable event/wait API                        | Required for multi-user collaboration and unattended execution                                     |
| Add       | Forma compiler/package integration                                                 | Required for the promised first-language experience                                                |

Avoid moving factory state into React or HTTP handlers. Keep serialized contracts
in `protocol`, model execution in `agent`, editor composition in `ide`, provider
reconciliation in its existing layer, and application orchestration in a
React-free service layer with replaceable persistence/Git/execution ports.

## Prioritized path from this checkout

The companion plan contains the detailed infrastructure gates. From a product
perspective, the most useful sequence is:

1. **Write the factory contracts and prove dependencies.** Agree on instance,
   draft, run, check, review and merge records. Verify real Forma distribution
   and the beta.84 Sandbox/Artifacts/Gateway path. Resolve the Open Ontology and
   Triplex positioning questions.
2. **Build durable instance and draft services.** One repo with an initial
   commit per instance, isolated branch per draft, persistent messages,
   idempotent initialization and recovery. A JSON/YAML fixture can exercise the
   infrastructure before Forma is wired.
3. **Make execution independent of the browser.** Start, supervise, cancel and
   recover sandbox runs; publish commits through the server; expose replayable
   events and bounded wait. Enforce one active writer per draft.
4. **Deliver Forma checks and collaborative review.** Show exact revision diffs,
   diagnostic results, comments and approvals; invalidate stale decisions.
5. **Enforce safe merges and expose the workflow to external agents.** Test
   simultaneous drafts, changed main, rejected stale writes, interrupted merge,
   and the same lifecycle through MCP with a scoped principal.
6. **Expand existing stage deployment to the complete product.** Add resource
   migrations, preview isolation, quotas, cleanup of runtime data, and recovery
   exercises. Keep SaaS apply as a separate later integration.

Factory services, Git ownership, run durability, and merge policy are on the
critical path. Full semantic diffs, general direct-agent workspaces, automatic
model selection, a large provider catalog, and live Salesforce changes are not.
Use acceptance milestones rather than unsupported calendar estimates.

## Evidence and verification boundary

The audit reviewed the root/authoritative guides, package manifests, Cloudflare
stack/router/DO implementations, Git store and branch operations, chat/runtime
state, document/protocol schemas, UI wiring, workflow definitions, and relevant
tests. Searches found no factory aggregate, MCP server, Sandbox application
runner, or Forma/Triplex runtime adapter in those sources.

Existing evidence is substantial but has a narrower scope than the vision:

- [Git package tests](../packages/git-artifacts/test/git-artifact-store.test.ts)
  cover commits and branch operations, including fast-forward and divergence
  behavior; they do not establish factory authorization or concurrent remote
  merges.
- [Cloudflare tests](../packages/cloudflare/test/worker-runtime.test.ts) and
  [workspace tests](../packages/cloudflare/test/workspace-object.test.ts) exercise
  hosted routing/storage with substitutes, not an account-backed Sandbox runner.
- [Hosted browser walkthrough](../apps/playground/tests/app/e2e-hosted.spec.ts)
  covers hosted edit/history/deploy/branch UI; its
  [support server](../apps/playground/tests/support/hosted-workspace-server.mjs)
  is local. The [fork/merge walkthrough](../apps/playground/tests/app/e2e-fork-merge.spec.ts)
  uses a scripted agent and local Git. These are useful integration fixtures,
  not a two-user hosted factory proof.
- The deployed [Cloudflare smoke](../scripts/smoke-cloudflare-preview.mjs)
  provisions a workspace, checks metadata, and verifies upload-pack/receive-pack
  advertisements through the Git proxy. It does **not** perform a full
  clone/edit/push/merge transaction or exercise durable agent execution.
- Production/preview workflow definitions prove that deployment automation is
  configured. This analysis did not inspect account inventory, deployment logs,
  quotas, model entitlements, or live tenant data.

Completing the vision requires new acceptance evidence: two independently
editable drafts, browser-independent runs, real pinned Forma checks, approvals
bound to current revisions, safe merges when main advances, crash recovery, and
an equivalent instance-scoped MCP flow. The repository is a strong foundation
for that product, but those capabilities should stay labeled proposed until
they are built and exercised.
