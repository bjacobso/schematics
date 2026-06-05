# Schematics

**Schematics is an Effect-native workbench for turning schema-defined files into validated systems that humans, agents, and runtimes can all understand.**

## Short pitch

Most AI coding and config tools treat files as text and bolt validation on after the model edits them. Schematics starts from the opposite assumption: **the schema is the contract.**

In Schematics, every file is an artifact, every artifact is routed to an Effect Schema, every schema can expose inspectable views, and every agent edit runs through the same typed runtime that powers the UI and deployment engine.

That makes Schematics a practical foundation for domain IDEs, config-as-code workbenches, agent editing surfaces, and schema-backed operational tools.

## What it is

Schematics is three things that share one contract:

- **A typed artifact runtime** for files, blobs, generated outputs, and remote objects.
- **A React IDE** for editing schema-routed projects with diagnostics, previews, forms, timelines, and agent chat.
- **A config-as-code engine** for pulling live state, editing files, planning diffs, applying changes, and monitoring drift.

The common primitive is an **artifact project**:

```text
artifact ref -> route -> schema -> views -> diagnostics/tools/deploy
```

The schema is not just a validator. It is the shared language between the human, the UI, the agent, and the runtime.

## Why now

Teams are starting to let agents edit important structured files: customer configuration, workflows, forms, policies, prompts, evals, infrastructure, and internal DSLs.

Plain text tools are not enough for that work. The agent needs to know:

- what each file means
- which schema applies
- what references are valid
- what downstream systems will change
- whether a proposed patch is safe
- what it will cost to inspect or materialize a view
- what deploy plan would result

Schematics answers each of those from the same schema contract. Every file is an artifact ref, every path is routed to a schema-backed artifact type, and every tool call the agent makes is checked against that contract before it lands:

- **Schema-routed artifact project.** Files are addressed by artifact refs; paths match artifact routes by glob; validation runs continuously and produces a structured `SchematicsReflection`.
- **Reflection stream.** Diagnostics, parsed values, route matches, and validation summaries are first-class — consumable by the UI and the agent on equal footing.
- **Schema-driven editor intelligence.** CodeMirror uses the generated JSON Schema for completions, hover, lint actions, quick fixes, and reference lookups.
- **Agent tools scoped to artifacts.** `list_artifacts`, `get_artifact_capabilities`, `read_artifact_view`, `write_artifact_source`, and compatibility file/workspace aliases all execute through artifact refs and declared views.
- **Safe edit modes.** Direct mode can atomically apply validated multi-file edits; plan mode exposes read-only tools plus `propose_patch` for user approval.
- **Bring-your-own model.** Ships with a standalone OpenRouter HTTP server, a typed HTTP client adapter, and a local debug adapter; the `SchematicsChatAdapter` contract is small enough to wire to anything.
- **React component.** `<Schematics />` gives you the CodeMirror editor, schema-derived form view, file tree, proposal review panel, diagnostics pane, timeline, and chat panel out of the box.
- **Config-as-code deploy.** A Terraform/Alchemy-style `pull → edit → plan → apply` loop (`@schematics/alchemy`) turns those validated artifact files into a managed deployment against an external API — diff, dependency-ordered apply, lockfile identity, and drift, all from the same schema contract.

## Config-as-code (Terraform-style deploy)

`@schematics/alchemy` mimics Alchemy/Terraform's resource lifecycle from
first principles, but the "cloud" is any config API and the desired state is your
artifact files:

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

`@schematics/example-catalog` is the reference implementation: a public-library
catalog with a mock `CatalogApi`, schemas for branches/authors/shelves/items/
collections/loan-policies (a full tour of the relation algebra), and a
`catalog-deploy` CLI. The shared config-as-code plumbing lives in
`@schematics/example-shared`, so each example wires only its domain.

## Architecture

```
        playground
            |
            v
      @schematics/ide
        |        |        |
        v        v        v
      core     agent      ui
                 |
                 v
              protocol <---- server

      algebra
      (semantic layer for core/react/agent)
```

The playground is intentionally package-local. It imports the split packages directly and talks to the standalone server through `/v1`, so it can be copied out without host app or runtime routes.

## Packages

The code is split into extractable packages:

- `@schematics/artifacts` — Effect-native artifact APIs, types, matchers, handlers, registries, stores, and project declarations.
- `@schematics/core` — Schematics artifact runtime, workspace compatibility projection, JSON/YAML codecs, validation, reflection, schema language-service helpers, and virtual filesystem helpers.
- `@schematics/algebra` — schema-native relation metadata, graph extraction, and validation. This is the future home for path algebra, traversal, constraints, lenses, projections, diffs, patches, generation, fingerprints, and other schema-derived IDE semantics.
- `@schematics/protocol` — OpenRouter-compatible chat schemas plus the Effect `HttpApi` contract.
- `@schematics/agent` — Effect AI tool definitions, tool execution, and chat adapters.
- `@schematics/ide` — the `<Schematics />` React surface, built directly on MUI primitives.
- `@schematics/server` — standalone Effect HTTP server for the OpenRouter proxy.
- `@schematics/cli` — local filesystem CLI for loading artifact project configs and printing diagnostics/routes/JSON Schema.
- `@schematics/alchemy` — provider-agnostic config-as-code engine: `pull/plan/apply/destroy`, schema-value diff, dependency ordering, lockfile state, and a lazy `HydratingArtifactStore`.
- `@schematics/example-shared` — domain-agnostic example plumbing: a generic config-as-code deploy service, YAML codec, fs artifact store, the `pull/plan/apply` CLI harness, and the preview-shell UI components.
- `@schematics/example-catalog` — the reference public-library catalog: relation-annotated schemas exercising the full algebra, a mock `CatalogApi`, the `catalog-deploy` CLI, the artifact project, the NYC Public Library sample, and embedded CLI bundle.
- `@schematics/example-toy` — the minimal two-kind schematic (cards + decks) with deliberately broken fixtures (`broken-refs`, `duplicate-ids`) that showcase diagnostics.
- `@schematics/examples` — generated JS examples backed by the catalog and toy artifact projects with their files on disk.

## Consuming Schematics externally

Building your own domain-specific config-as-code project on top of Schematics?
See **[docs/consuming-schematics.md](docs/consuming-schematics.md)** — the
recommended way to link the framework (git submodule today, npm later), build a
CLI binary, and optionally ship a frontend from `@schematics/ide`.
`examples/catalog` is the living reference.

## Who this is for

- **Config / IaC tooling** — agents editing Terraform, Helm, k8s, Pulumi manifests.
- **Form / CMS builders** — anyone with "schema-as-source-of-truth + AI authoring."
- **Prompt & eval shops** — agents authoring prompts, datasets, and evals as files where the schema _is_ the eval contract.
- **DSL authors** — Lisp-, YAML-, or JSON-shaped domain languages that need an authoring UI without writing one.
- **MCP server authors** — the tool surface maps cleanly to MCP; ship the same agent contract to any MCP client.

## Why Effect

The whole stack is Effect-native: schemas are `effect/Schema`, the chat adapter is moving toward `Effect<ChatResult, ChatError>` with `Stream` for tool-call and token events, and the workspace runtime is a `Context.Tag` service so test layers and production layers compose the same way. If you already speak Effect, this should feel like home.

## Schema Algebra

`@schematics/algebra` is the semantic layer that lets Effect Schema nodes
describe more than local validation. The first implemented capability is
relation metadata:

```ts
import { Schema } from "effect";
import { Relation } from "@schematics/algebra";

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

Pre-1.0. Public packaging (`@schematics/core`, `@schematics/ide`, `@schematics/agent`, `@schematics/server`) is the extraction target. Breaking changes are expected; pin exact versions.

## Local planning

`PLAN.md` is gitignored and reserved for local planning with coding agents. Use it for scratch plans, task breakdowns, and implementation notes that should stay out of commits.

## Roadmap highlights

- Schema-derived autocompletion and hover (Monaco / CodeMirror via JSON Schema language services).
- Patch-based time travel — every tool call produces a `WorkspacePatch` with undo/redo/branch.
- Diff-and-approve mode — agent proposes, user applies.
- Cross-file constraints with structured references between schemas, powered by `@schematics/algebra`.
- Plan mode — read-only tool subset plus a `propose_patch` tool that does not apply.
- Atomic `apply_edits` tool with validation rollback.
- Token-aware reflection summarization.
- Tool-call eval harness — regression-test prompt changes against (schema, files, prompt) fixtures.
- MCP server exposing the same tool surface.
- Schema algebra modules for paths, traversal, annotations, constraints, lenses, projections, diffs, patches, generation, and schema fingerprints.

## Artifact-first authoring

New Schematics projects should start from an `ArtifactProject`. The project is
the route and capability contract used by React, the CLI, protocol clients, and
agent tools. `Workspace.Struct` is deprecated compatibility sugar for older
callers and tests. The catalog and toy examples are the reference
artifact-first examples.

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

The repository includes `.github/workflows/cloudflare-production.yml` for
Cloudflare production deploys. Pushes to `main` deploy the `prod` Alchemy stage,
which includes the Cloudflare Vite playground and API worker.

The root `alchemy.run.ts` can also deploy the same stack from a local shell:

```bash
pnpm playground:deploy:dry-run
pnpm playground:deploy
```

Alchemy deploys `apps/playground` with `Cloudflare.Vite` and prints
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
