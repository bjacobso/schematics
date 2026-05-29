## Schema IDE

A typed artifact project runtime, validation reflection, and agent toolbelt — packaged as a drop-in IDE for editing structured files with an LLM in the loop.

### The pitch

Most "AI edits my config" experiences treat the model as the source of truth and bolt validation on after the fact. Schema IDE inverts that: **the Effect Schema artifact project is the contract between human, agent, and runtime.** Every file is an artifact ref, every path is routed to a schema-backed artifact type, and every tool call the agent makes is checked against that contract before it lands.

The pieces:

- **Schema-routed artifact project.** Files are addressed by artifact refs; paths match artifact routes by glob; validation runs continuously and produces a structured `SchemaIdeReflection`.
- **Reflection stream.** Diagnostics, parsed values, route matches, and validation summaries are first-class — consumable by the UI and the agent on equal footing.
- **Schema-driven editor intelligence.** CodeMirror uses the generated JSON Schema for completions, hover, lint actions, quick fixes, and reference lookups.
- **Agent tools scoped to artifacts.** `list_artifacts`, `get_artifact_capabilities`, `read_artifact_view`, `write_artifact_source`, and compatibility file/workspace aliases all execute through artifact refs and declared views.
- **Safe edit modes.** Direct mode can atomically apply validated multi-file edits; plan mode exposes read-only tools plus `propose_patch` for user approval.
- **Bring-your-own model.** Ships with a standalone OpenRouter HTTP server, a typed HTTP client adapter, and a local debug adapter; the `SchemaIdeChatAdapter` contract is small enough to wire to anything.
- **React component.** `<SchemaIde />` gives you the CodeMirror editor, schema-derived form view, file tree, proposal review panel, diagnostics pane, timeline, and chat panel out of the box.

### Architecture

```
        playground
            |
            v
      @schema-ide/react
        |        |        |
        v        v        v
      core     agent      ui
                 |
                 v
              protocol <---- server

      schema-algebra
      (semantic layer for core/react/agent)
```

The playground is intentionally package-local. It imports the split packages directly and talks to the standalone server through `/v1`, so it can be copied out without host app or runtime routes.

### Packages

The code is split into extractable packages:

- `@schema-ide/artifacts` — Effect-native artifact APIs, types, matchers, handlers, registries, stores, and project declarations.
- `@schema-ide/core` — Schema IDE artifact runtime, workspace compatibility projection, JSON/YAML codecs, validation, reflection, schema language-service helpers, and virtual filesystem helpers.
- `@schema-ide/schema-algebra` — schema-native relation metadata, graph extraction, and validation. This is the future home for path algebra, traversal, constraints, lenses, projections, diffs, patches, generation, fingerprints, and other schema-derived IDE semantics.
- `@schema-ide/protocol` — OpenRouter-compatible chat schemas plus the Effect `HttpApi` contract.
- `@schema-ide/agent` — Effect AI tool definitions, tool execution, and chat adapters.
- `@schema-ide/react` — the `<SchemaIde />` React surface, built directly on MUI primitives.
- `@schema-ide/server` — standalone Effect HTTP server for the OpenRouter proxy.
- `@schema-ide/cli` — local filesystem CLI for loading artifact project configs and printing diagnostics/routes/JSON Schema.
- `@schema-ide/onboarded-config` — first-party Onboarded account artifact project, sample files, and embedded CLI bundle.
- `@schema-ide/examples` — generated JS examples backed by artifact projects plus neutral prompt eval, survey, and workflow files on disk.

### Who this is for

- **Config / IaC tooling** — agents editing Terraform, Helm, k8s, Pulumi manifests.
- **Form / CMS builders** — anyone with "schema-as-source-of-truth + AI authoring."
- **Prompt & eval shops** — agents authoring prompts, datasets, and evals as files where the schema _is_ the eval contract.
- **DSL authors** — Lisp-, YAML-, or JSON-shaped domain languages that need an authoring UI without writing one.
- **MCP server authors** — the tool surface maps cleanly to MCP; ship the same agent contract to any MCP client.

### Why Effect

The whole stack is Effect-native: schemas are `effect/Schema`, the chat adapter is moving toward `Effect<ChatResult, ChatError>` with `Stream` for tool-call and token events, and the workspace runtime is a `Context.Tag` service so test layers and production layers compose the same way. If you already speak Effect, this should feel like home.

### Schema Algebra

`@schema-ide/schema-algebra` is the semantic layer that lets Effect Schema nodes
describe more than local validation. The first implemented capability is
relation metadata:

```ts
import { Schema } from "effect";
import { Relation } from "@schema-ide/schema-algebra";

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

### Status

Pre-1.0. Public packaging (`@schema-ide/core`, `@schema-ide/react`, `@schema-ide/agent`, `@schema-ide/server`) is the extraction target. Breaking changes are expected; pin exact versions.

### Local planning

`PLAN.md` is gitignored and reserved for local planning with coding agents. Use it for scratch plans, task breakdowns, and implementation notes that should stay out of commits.

### Roadmap highlights

- Schema-derived autocompletion and hover (Monaco / CodeMirror via JSON Schema language services).
- Patch-based time travel — every tool call produces a `WorkspacePatch` with undo/redo/branch.
- Diff-and-approve mode — agent proposes, user applies.
- Cross-file constraints with structured references between schemas, powered by `@schema-ide/schema-algebra`.
- Plan mode — read-only tool subset plus a `propose_patch` tool that does not apply.
- Atomic `apply_edits` tool with validation rollback.
- Token-aware reflection summarization.
- Tool-call eval harness — regression-test prompt changes against (schema, files, prompt) fixtures.
- MCP server exposing the same tool surface.
- Schema algebra modules for paths, traversal, annotations, constraints, lenses, projections, diffs, patches, generation, and schema fingerprints.

### Artifact-first authoring

New Schema IDE projects should start from an `ArtifactProject`. The project is
the route and capability contract used by React, the CLI, protocol clients, and
agent tools. `Workspace.Struct` still exists as compatibility sugar for older
callers and tests, but the first-party examples now author artifact projects and
derive any temporary workspace projection from those routes.

### Example

```tsx
import { Schema } from "effect";
import { ArtifactProject } from "@schema-ide/artifacts";
import { SchemaIdeWorkspaceFileArtifact } from "@schema-ide/core";
import { createSchemaIdeChatAdapter } from "@schema-ide/agent";
import { SchemaIde } from "@schema-ide/react";

const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

const UserProject = ArtifactProject.make("users").files("users/*.yaml", {
  id: "Users",
  type: SchemaIdeWorkspaceFileArtifact,
  schema: UserSchema,
  metadata: {
    attributes: {
      workspaceField: "users",
      indexBy: "id",
      format: "yaml",
    },
  },
});

<SchemaIde
  project={UserProject}
  initialFiles={[{ path: "users/alice.yaml", content: "id: alice\nname: Alice\n" }]}
  chat={createSchemaIdeChatAdapter({ baseUrl: "/v1" })}
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
schema-ide validate --schema ./schema-ide.config.ts --dir . --json
```

The bundled examples can also be tried from disk:

```bash
schema-ide validate \
  --schema packages/examples/workspaces/workflow-json/schema-ide.config.ts \
  --dir packages/examples/workspaces/workflow-json/files \
  --json
```

Run the first-party Onboarded config CLI by building its package and invoking
the embedded command:

```bash
pnpm turbo run build --filter @schema-ide/onboarded-config
node packages/onboarded-config/dist/cli.js validate \
  --dir packages/onboarded-config/workspaces/onboarded-account-yaml/files \
  --json
```

To smoke-test the consumer-style bundle:

```bash
pnpm turbo run build:bundle --filter @schema-ide/onboarded-config
node packages/onboarded-config/dist/bundle/onboarded-config.cjs validate \
  --dir packages/onboarded-config/workspaces/onboarded-account-yaml/files \
  --json
```

The bundle also embeds the built playground UI, so it can serve the web app as a
single Node entry without `apps/playground/dist` on disk:

```bash
node packages/onboarded-config/dist/bundle/onboarded-config.cjs web \
  --dir packages/onboarded-config/workspaces/onboarded-account-yaml/files
```

Build a single Node SEA binary from the same bundled entry with:

```bash
pnpm turbo run build:sea --filter @schema-ide/onboarded-config -- \
  --out packages/onboarded-config/dist/sea/onboarded-config
```

Run the Onboarded artifact project in the local web UI with:

```bash
pnpm playground:build
pnpm turbo run build --filter @schema-ide/onboarded-config
node packages/onboarded-config/dist/cli.js web \
  --dir packages/onboarded-config/workspaces/onboarded-account-yaml/files
```

Without `SCHEMA_IDE_OPENROUTER_API_KEY`, the server uses a local debug chat responder so the package-local UI and HTTP loop still work. Set `SCHEMA_IDE_OPENROUTER_API_KEY` or `OPENROUTER_API_KEY` to proxy real model calls through OpenRouter.

After building, the server package also exposes a `schema-ide-server` binary and `pnpm --dir packages/server start`.

Build and serve the isolated package UI and HTTP API from one Node process with:

```bash
pnpm serve
```

That command builds `@schema-ide/*`, builds the playground, starts `@schema-ide/server`, serves the playground at `/`, and reserves `/v1` for the chat/model/health API.
Run `pnpm serve:smoke` to verify the same path in automation.

### Deploy the playground

The repository includes `.github/workflows/playground-pages.yml` for GitHub Pages. Enable Pages with GitHub Actions as the source; pushes to `main` publish `apps/playground/dist`.

If the hosted playground should use chat, deploy `@schema-ide/server` separately and set a repository variable named `SCHEMA_IDE_API_BASE_URL` to that server's root URL. Without that variable, the static playground still loads examples and validates files, but chat calls stay relative to the current origin.

The deployed URL will be:

```text
https://<owner>.github.io/<repo>/
```

The repository also includes a root `alchemy.run.ts` for deploying the playground to Cloudflare with Alchemy:

```bash
pnpm playground:deploy:dry-run
pnpm playground:deploy
```

Alchemy deploys `apps/playground` with `Cloudflare.Vite` and prints `playgroundUrl` when the stack applies. Set `VITE_SCHEMA_IDE_API_BASE_URL` or `SCHEMA_IDE_API_BASE_URL` before deploy to point the hosted playground at a deployed Schema IDE server root URL; otherwise chat remains relative to the Cloudflare origin.

Production deploys use the `prod` Alchemy stage:

```bash
pnpm alchemy deploy --stage prod --yes
```

Pull requests from this repository deploy isolated preview stacks named
`pr-<number>` and post the playground/API URLs back to the PR. GitHub Actions
requires these repository secrets for Cloudflare deployment:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `OPENROUTER_API_KEY`

Stale PR previews are cleaned up by the nightly Cloudflare cleanup workflow.
The cleanup only considers Alchemy stages named `pr-<number>` and destroys them
after the matching GitHub PR has been closed for the configured number of days.
You can preview the cleanup locally with:

```bash
pnpm cloudflare:cleanup --dry-run --days 7
```

The local Node server and Cloudflare worker both wrap the same `makeSchemaIdeAppLayer` entrypoint. They pass different debug-chat labels so a missing model key is obvious:

- Local: set `OPENROUTER_API_KEY` or `SCHEMA_IDE_OPENROUTER_API_KEY` in your shell or repo `.env`.
- Cloudflare: set `OPENROUTER_API_KEY` in the Cloudflare/Alchemy deployment environment, then redeploy.

Without a key, chat still responds in deterministic debug mode and does not call a model.

When copied into its own repository, this directory includes its own `pnpm-workspace.yaml`, `tsconfig.base.json`, CI workflow, license, and contribution docs.
