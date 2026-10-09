# Schematics

**Schematics is an Effect-native config-as-code control plane for external APIs and SaaS resources.**

Pre-1.0 and experimental; its workspace packages are private and unpublished.
Expect breaking changes. Try the
[playground](https://schematics.run/playground), or run it locally with
Node 25.9.0, pnpm 11.1.3, `pnpm install --frozen-lockfile`, and `pnpm dev`.

## Short pitch

Connect an API, describe its resource kinds with Effect Schema, and get typed
documents, semantic plans, agent tools, review, apply, and drift detection from
one contract.

Schematics applies the independent Schema Reflection libraries to external
resource management. Schema Reflection makes relationships, conditions, and
behavior inspectable as data; Schematics supplies providers, document editing,
plans, review, and apply. Today it consumes `@schema-reflection/algebra` from npm.
Further library adoption and Triplex persistence are planned.

The [public site](https://schematics.run/) introduces both Schematics and the
Schema Reflection family. Its library demos are simulations; the
[playground](https://schematics.run/playground) runs the Schematics editor and
example providers.

See [Schematics in the constellation](docs/architecture-constellation.md) for
the ownership boundaries and migration sequence.

## What it is

Schematics brings four product capabilities around one resource contract:

- **Provider integration** for observing and mutating external resources.
- **Desired-state documents** for editing resource declarations with continuous validation.
- **Semantic reconciliation** for diffing declarations against observations and applying dependency-ordered plans.
- **Human and agent review** through the same typed capabilities, diagnostics, and provenance contract.

The product lifecycle is:

```text
provider -> observations -> declarations -> plan -> review -> apply -> new observations
```

The existing `ArtifactProject` API is the current routing and capability contract
for schema-routed documents while the public vocabulary migrates to resources,
declarations, releases, and observations. “Artifact” is reserved for published
outputs such as generated HTML.

## Why now

Teams increasingly need humans and agents to manage important external
configuration: repositories, identity providers, incident systems, CRM objects,
workflows, policies, and infrastructure.

Plain text tools are not enough for that work. The agent needs to know:

- what each file means
- which schema applies
- what references are valid
- what downstream systems will change
- whether a proposed patch is safe
- what it will cost to inspect or materialize a view
- what deploy plan would result

Schematics answers each of those from the same resource contract. The current
implementation routes documents through transitional artifact APIs, and every
tool call is checked before it lands:

- **Schema-routed artifact project.** Files are addressed by artifact refs; paths match artifact routes by glob; validation runs continuously and produces a structured `SchematicsReflection`.
- **Reflection stream.** Diagnostics, parsed values, route matches, and validation summaries are first-class — consumable by the UI and the agent on equal footing.
- **Schema-driven editor intelligence.** CodeMirror uses the generated JSON Schema for completions, hover, lint actions, quick fixes, and reference lookups.
- **Agent tools scoped to artifacts.** `list_artifacts`, `get_artifact_capabilities`, `read_artifact_view`, `write_artifact_source`, and compatibility file/workspace aliases all execute through artifact refs and declared views.
- **Safe edit modes.** Direct mode can atomically apply validated multi-file edits; plan mode exposes read-only tools plus `propose_patch` for user approval.
- **Bring-your-own model.** Ships with a standalone OpenRouter HTTP server, a typed HTTP client adapter, and a local debug adapter; the `SchematicsChatAdapter` contract is small enough to wire to anything.
- **React component.** `<Schematics />` gives you the CodeMirror editor, schema-derived form view, file tree, proposal review panel, diagnostics pane, timeline, and chat panel out of the box.
- **Config-as-code reconciliation.** A Terraform/Alchemy-style `pull → edit → plan → apply` loop (`@schematics/alchemy`, pending rename to a reconciliation package) turns validated declarations into managed changes against an external API.

## Config-as-code (Terraform-style deploy)

`@schematics/alchemy` implements a Terraform-style resource lifecycle from
first principles. The package name is retained for compatibility while its
public contract moves toward resource reconciliation; the "cloud" can be any
external API and desired state is expressed as typed documents:

- **Providers** speak `list / read / create / update / delete` per entity kind.
- **`pull`** hydrates the working tree from the API; **`plan`** diffs your files
  against live (schema-value diff → create/update/delete/no-op); **`apply`**
  executes in dependency order with optimistic-concurrency guards; **`destroy`**
  unwinds it.
- **Lockfile identity** (`config.lock.json`) maps human slugs ↔ opaque remote ids,
  and resolves cross-entity references during apply.
- **Lazy/streaming sync** — a `HydratingArtifactStore` can lay out a skeleton from
  list endpoints and hydrate file contents on first access, so the IDE fills in
  over time.

`@schematics/provider` is the authoring layer for domain providers. A provider
is a named external system plus the resources it manages: `defineResource(...)`
describes each file-level resource, and `defineProvider(...)` derives the
artifact project, workspace schema, relation diagnostics, mock transport,
reconciler, deploy service, and CLI wiring. `examples/toy` is the smallest
provider reference; `examples/catalog` remains the richest relation-modeling
reference.

## Fit in the WorldVM family

[WorldVM](https://worldvm.com) brings together independent libraries and products
with distinct responsibilities:

| Project           | Responsibility                                                                        | Schematics relationship                                             |
| ----------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Schema Reflection | Inspectable schemas, relations, conditions, and behavior                              | Algebra is consumed today; further adoption is planned              |
| Triplex           | Facts, time, queries, definition releases, history, and provenance                    | Intended durable store for declarations, releases, and observations |
| WorldVM           | Operational worlds: goals, permissions, reconciliation, and durable Program execution | A future host could use Schematics to manage external configuration |
| Forma             | Language authoring, parsing, elaboration, and code generation                         | Optional document authoring direction                               |
| Foldworks         | Reusable interaction primitives built on Foldkit                                      | Used by landing-page demos; broader UI extraction is planned        |
| Open Ontology     | Operational workflow product                                                          | Potential consumer of Schematics resource-management capabilities   |
| Schematics        | External API providers, desired-state documents, resource plans, review, and apply    | The control plane implemented in this repository                    |

WorldVM's `Program<A, E, R>` describes computation as typed data, with durable
execution owned by its host. Schematics plans describe changes to external
resources. Connecting the two is future integration work: Schematics owns the
provider lifecycle, while WorldVM owns execution within an operational world.
Schema Reflection's sequential workflow prototype is a separate library;
WorldVM uses its own Program kernel for new execution.

Schematics and Triplex share Effect `4.0.0-rc.112`, but no Triplex persistence
adapter is shipped here. Schema Reflection's newer source APIs need a tested
Effect pairing before adoption. Independently deployed services exchange
serialized contracts. See the [architecture guide](docs/architecture-constellation.md)
for ownership boundaries and the migration sequence.

## Packages

The workspace consumes `@schema-reflection/algebra@0.1.0` from npm. The
repository is in a boundary migration; its own packages currently are:

- `@schematics/artifacts` — Effect-native artifact APIs, types, matchers, handlers, registries, stores, and project declarations.
- `@schematics/core` — Schematics artifact runtime, workspace compatibility projection, JSON/YAML codecs, validation, reflection, schema language-service helpers, and virtual filesystem helpers.
- `@schematics/protocol` — OpenRouter-compatible chat schemas plus the Effect `HttpApi` contract.
- `@schematics/agent` — Effect AI tool definitions, tool execution, and chat adapters.
- `@schematics/ide` — the `<Schematics />` React surface, built directly on MUI primitives.
- `@schematics/server` — standalone Effect HTTP server for the OpenRouter proxy.
- `@schematics/cli` — local filesystem CLI for loading artifact project configs and printing diagnostics/routes/JSON Schema.
- `@schematics/alchemy` — transitional name for the provider-agnostic reconciliation engine: `pull/plan/apply/destroy`, semantic diff, dependency ordering, state, and lazy hydration.
- `@schematics/deploy` — framework deploy service plumbing used by provider-backed projects.
- `@schematics/provider` — provider DSL: resources, provider composition, derived artifact projects, diagnostics, mock transports, reconcilers, deploy service integration, and provider CLI helpers.
- `@schematics/example-catalog` — the rich public-library catalog: relation-annotated schemas exercising the full algebra, a mock `CatalogApi`, catalog deploy tooling, the artifact project, the NYC Public Library sample, and embedded CLI bundle.
- `@schematics/example-toy` — the minimal provider DSL example (cards + decks) with deliberately broken fixtures (`broken-refs`, `duplicate-ids`) that showcase diagnostics.
- `@schematics/example-github`, `@schematics/example-okta`, `@schematics/example-pagerduty`, `@schematics/example-salesforce` — SaaS provider examples with derived mocks, deploy services, CLIs, and seeded fixture workspaces.
- `@schematics/examples` — generated JS examples backed by the first-party artifact projects and fixture files on disk.

## Consuming Schematics externally

Building your own domain-specific config-as-code project on top of Schematics?
See **[docs/consuming-schematics.md](docs/consuming-schematics.md)** — the
recommended way to link the framework (git submodule today, npm later), build a
CLI binary, and optionally ship a frontend from `@schematics/ide`.
Start with `examples/toy` for the smallest provider package and use
`examples/catalog` when you need a dense relation-modeling reference.

## Who this is for

- **SaaS platform teams** exposing a safe config-as-code surface over their API.
- **Internal platform teams** managing repositories, identity, incident response, CRM, and workflow configuration together.
- **Agent product teams** that need inspectable capabilities and reviewable plans instead of browser automation.
- **Open Ontology and similar products** that want typed external-resource management without rebuilding the control plane.

## Schema Reflection

Effect Schema provides runtime structure as well as validation. Schema Reflection
uses that structure to make application semantics available to editors, agents,
and interpreters. The libraries stay independent of Schematics: provider clients,
credentials, authorization, remote identity, and plan/apply orchestration belong
in this control plane.

| Library                                                   | Purpose                                             | Status and use in Schematics                                                                   |
| --------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [Algebra](https://schematics.run/packages/algebra/)       | Relationships and structure as data                 | Published `0.1.0`; used for relation graphs and diagnostics                                    |
| [Predicates](https://schematics.run/packages/predicates/) | Conditions as immutable data                        | Published `0.1.0`; policy, selection, and approval conditions are planned                      |
| [Logic](https://schematics.run/packages/logic/)           | Inspectable behavior as data                        | Published `0.1.0`; newer typed portable APIs are experimental source work; adoption is planned |
| [Core](https://schematics.run/packages/core/)             | Portable schema contracts and symbolic expressions  | Experimental source APIs; not a Schematics dependency                                          |
| [Workflow](https://schematics.run/packages/workflow/)     | Sequential processes and checkpoint transitions     | Source prototype; persistence and execution services are host responsibilities                 |
| [Filesystem](https://schematics.run/packages/filesystem/) | Schema-routed directories and cross-file validation | Specification and type stub; no shipped runtime                                                |

`@schema-reflection/core` is the portable-contract library;
`@schematics/core` is this product's document runtime. Likewise, the proposed
filesystem library does not replace the shipped `ArtifactProject` runtime today.
Neutral document-routing and validation primitives are candidates for upstream
reuse as that library develops.

### Relations in use today

`@schema-reflection/algebra` is the semantic layer that lets Effect Schema nodes
describe more than local validation. The first implemented capability is
relation metadata:

```ts
import { Schema } from "effect";
import { Relation } from "@schema-reflection/algebra";

const ActionSchema = Schema.Struct({
  id: Relation.id("Action"),
  label: Schema.String,
});

const WorkflowSchema = Schema.Struct({
  id: Relation.id("Workflow"),
  actionIds: Relation.refs("Action"),
});
```

From those annotations, algebra can extract a relation graph and validate
duplicate IDs, unresolved references, scoped references, and invalid relation
values. The larger direction is to derive autocomplete, go-to-definition,
find-references, safe rename, impact analysis, patch generation, and
agent-constrained edits from the same schema declarations.

## Status

Pre-1.0 and mid-migration. The editor, relation diagnostics, agent patch review,
and provider pull/plan/apply loop are implemented. Schematics packages remain
private. Triplex persistence, WorldVM integration, further Schema Reflection
adoption, and broader Foldworks UI reuse remain future work. Breaking changes
are expected.

## Local planning

`PLAN.md` is gitignored and reserved for local planning with coding agents. Use it for scratch plans, task breakdowns, and implementation notes that should stay out of commits.

## Planned work

- Adopt Schema Reflection predicates and logic for concrete product features after testing a compatible Effect release.
- Add Triplex-backed definitions, immutable releases, observations, and provenance; bind plans to a desired release and observed basis.
- Migrate public artifact terminology to resources, declarations, documents, and observations while retaining compatibility for existing callers.
- Upstream neutral schema traversal, fingerprints, paths, diffs, patches, and document validation into Schema Reflection.
- Extract reusable controls into Foldworks and retain resource-aware composition in Schematics.
- Expose the existing typed tool surface through MCP and expand tool-call evaluation.

## Transitional document runtime

New Schematics projects should start from an `ArtifactProject`. The project is
the route and capability contract used by React, the CLI, protocol clients, and
agent tools. It is an implementation-stage name for a schema-routed document
project, not the long-term product vocabulary. `Workspace.Struct` is deprecated compatibility sugar for older
callers and tests. Provider-backed projects usually get their `ArtifactProject`
from `defineProvider(...)`; see `examples/toy` for the minimal resource/provider
shape.

## Example

```tsx
import { Schema } from "effect";
import { ArtifactProject } from "@schematics/artifacts";
import { SchematicsProjectFileArtifact } from "@schematics/core";
import { createSchematicsChatAdapter } from "@schematics/agent";
import { Schematics } from "@schematics/ide";

const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

const UserProject = ArtifactProject.make("users").files("users/*.yaml", {
  id: "Users",
  type: SchematicsProjectFileArtifact,
  schema: UserSchema,
  metadata: {
    attributes: {
      workspaceField: "users",
      indexBy: "id",
      format: "yaml",
    },
  },
});

<Schematics
  project={UserProject}
  initialFiles={[{ path: "users/alice.yaml", content: "id: alice\nname: Alice\n" }]}
  chat={createSchematicsChatAdapter({ baseUrl: "/v1" })}
/>;
```

Run the isolated playground with:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Run just the standalone HTTP server with:

```bash
pnpm --dir packages/server dev
```

Run targeted tests through Turbo so workspace dependencies are built before
tests that import package `dist` entrypoints:

```bash
pnpm turbo run test --filter @schematics/cli
pnpm turbo run typecheck --filter @schematics/ide
```

Run `pnpm check` for formatting, the agent docs check, tests, types, builds,
and the local server smoke check. See [AGENTS.md](AGENTS.md) for repository
commands and conventions. The site serves an agent entry point at
[/llms.txt](https://schematics.run/llms.txt); its source is
`apps/playground/public/llms.txt`.

Avoid `pnpm --filter <package> test` for packages whose tests load consumer
configs or package exports; that bypasses Turbo's dependency graph and can fail
in a fresh checkout with missing `dist` files.

Validate a local directory with a consumer artifact project config:

```bash
schematics validate --schema ./schematics.config.ts --dir . --json
```

The bundled examples can also be tried from disk:

```bash
schematics validate \
  --schema examples/toy/projects/valid/schematics.config.ts \
  --dir examples/toy/projects/valid/files \
  --json
```

Run the reference catalog config CLI by building its package and invoking
the embedded command:

```bash
pnpm turbo run build --filter @schematics/example-catalog
node examples/catalog/dist/cli.js validate \
  --dir examples/catalog/projects/nyc-public-library/files \
  --json
```

Pull the live (mock) NYC Public Library catalog to disk, then plan a change:

```bash
node examples/catalog/dist/deploy-cli-bin.js pull --dir /tmp/nypl
node examples/catalog/dist/deploy-cli-bin.js plan --dir /tmp/nypl
```

To smoke-test the consumer-style bundle:

```bash
pnpm turbo run build:bundle --filter @schematics/example-catalog
node examples/catalog/dist/bundle/catalog-config.cjs validate \
  --dir examples/catalog/projects/nyc-public-library/files \
  --json
```

The bundle also embeds the built playground UI, so it can serve the web app as a
single Node entry without `apps/playground/dist` on disk:

```bash
node examples/catalog/dist/bundle/catalog-config.cjs web \
  --dir examples/catalog/projects/nyc-public-library/files
```

Build a single Node SEA binary from the same bundled entry with:

```bash
pnpm turbo run build:sea --filter @schematics/example-catalog -- \
  --out examples/catalog/dist/sea/catalog-config
```

Run the catalog artifact project in the local web UI with:

```bash
pnpm playground:build
pnpm turbo run build --filter @schematics/example-catalog
node examples/catalog/dist/cli.js web \
  --dir examples/catalog/projects/nyc-public-library/files
```

Without `SCHEMATICS_OPENROUTER_API_KEY`, the server uses a local debug chat responder so the package-local UI and HTTP loop still work. Set `SCHEMATICS_OPENROUTER_API_KEY` or `OPENROUTER_API_KEY` to proxy real model calls through OpenRouter.

After building, the server package also exposes a `schematics-server` binary and `pnpm --dir packages/server start`.

Build and serve the isolated package UI and HTTP API from one Node process with:

```bash
pnpm serve
```

That command builds `@schematics/*`, builds the playground, starts `@schematics/server`, serves the playground at `/`, and reserves `/v1` for the chat/model/health API.
Run `pnpm serve:smoke` to verify the same path in automation.

## Deploy the playground

The public homepage is generated by Astro. Its existing JSX prose and diagrams
render at build time without React hydration. Interactive package simulations
load Foldkit and Foldworks (`@foldworks/ui`) as they approach the viewport; they
illustrate the documented APIs rather than executing Schema Reflection packages.
Foldkit 0.156.0 and Foldworks 0.2.0 match the workspace's Effect 4 RC.112 pin.
The React IDE has a separate browser entry for `/playground` and `/w/{id}`.
Static hosts retain the `index.html` fallback for hosted workspace URLs.

Each of the six featured libraries has a static page at `/packages/{name}/` with
its problem, capabilities, adoption steps, an API example, a scenario, and
composition guidance for the other libraries. Published releases, experimental
source APIs, and the proposed filesystem design are labeled separately; each
page states its runtime and host boundaries. Homepage package headings link to
these pages, which also appear in `llms.txt`.

The repository includes `.github/workflows/cloudflare-production.yml` for
Cloudflare production deploys. Pushes to `main` deploy the `prod` Alchemy stage,
which includes the Cloudflare static Astro homepage, React playground, and API worker.

The root `alchemy.run.ts` can also deploy the same stack from a local shell:

```bash
pnpm playground:deploy:dry-run
pnpm playground:deploy
```

Alchemy builds `apps/playground` with Astro and deploys its static output with
`Cloudflare.Website.StaticSite` and prints
`playgroundUrl` when the stack applies. It also deploys the Schematics API
worker and wires the playground to that API unless `VITE_SCHEMATICS_API_BASE_URL`
or `SCHEMATICS_API_BASE_URL` is set before deploy.

Production deploys use the `prod` Alchemy stage:

```bash
pnpm alchemy deploy --stage prod --yes
```

Main-branch production deploys and pull request previews both require these
repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Set `OPENROUTER_API_KEY` as a repository secret to enable hosted chat calls.
Pull requests from this repository deploy isolated preview stacks named
`pr-<number>` and post the playground/API URLs back to the PR.

Stale PR previews are cleaned up by the nightly Cloudflare cleanup workflow.
The cleanup only considers Alchemy stages named `pr-<number>` and destroys them
after the matching GitHub PR has been closed for the configured number of days.
You can preview the cleanup locally with:

```bash
pnpm cloudflare:cleanup --dry-run --days 7
```

The local Node server and Cloudflare worker both wrap the same `makeSchematicsAppLayer` entrypoint. They pass different debug-chat labels so a missing model key is obvious:

- Local: set `OPENROUTER_API_KEY` or `SCHEMATICS_OPENROUTER_API_KEY` in your shell or repo `.env`.
- Cloudflare: set `OPENROUTER_API_KEY` in the Cloudflare/Alchemy deployment environment, then redeploy.

Without a key, chat still responds in deterministic debug mode and does not call a model.

When copied into its own repository, this directory includes its own `pnpm-workspace.yaml`, `tsconfig.base.json`, CI workflow, license, and contribution docs.

Part of the [WorldVM](https://worldvm.com) family of experiments.
