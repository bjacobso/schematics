# Plan: Schematics as a Standalone OSS Project

Schematics should be extractable as an Effect-native OSS library, React IDE, local playground, and standalone HTTP proxy. The current phase proves that the package-local UI and HTTP server work in isolation before any host application integration changes.

> Current-tree note: this plan originally targeted a nested extractable package
> directory. After the Schematics rename/refactor, that tree no longer exists in
> this repository; the current in-repo layout is the root workspace with
> packages under `packages/`, examples under `examples/`, and the playground
> under `apps/playground`.

## Goals

- Ship reusable `@schematics/*` packages with no host application imports.
- Keep development end-to-end inside the Schematics workspace: local packages,
  local examples, local playground, local HTTP server.
- Make extraction into a dedicated repository a mechanical copy of this tree plus standard repo metadata.
- Keep the current host application as a consumer. Its temporary compatibility package now lives outside this extractable tree.

## Active Phase Gate

This phase is only about the isolated package UI and HTTP loop. A change is out of scope for this phase if it requires editing host application routes, host runtime handlers, ontology authoring code, or Open Ontology app wiring.

```
apps/playground
        │
        ▼
@schematics/ide ──▶ @schematics/agent ──▶ @schematics/protocol
        │                                      ▲
        ▼                                      │
@schematics/core                    @schematics/server
                                               │
                                               ▼
                                           OpenRouter
```

Do not change host app routes, runtime handlers, ontology authoring logic, or
host-specific proxy code while this gate is active. Any temporary host
compatibility must remain outside the extractable Schematics workspace.

The package must verify in two environments:

```
host monorepo checkout                  copied-out package repo
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ root Turbo sees nested config│        │ package scripts use local CI │
│ root turbo workspace         │        │ turbo.standalone.json        │
└──────────────────────────────┘        └──────────────────────────────┘
```

Package-local scripts are the supported interface for isolated work:

```bash
pnpm test --filter '@schematics/*'
pnpm typecheck --filter '@schematics/*'
pnpm build --filter '@schematics/*'
pnpm serve:smoke
```

## Non-goals

- Rewire host application routes or runtime proxy handlers during this phase.
- Add persistence adapters, MCP server support, or non-React UI packages.
- Add host-specific DSL, Datalog, auth, or storage concepts to the reusable package APIs.

## Current Layout

```
.
├── packages/core/      @schematics/core
├── packages/protocol/  @schematics/protocol
├── packages/agent/     @schematics/agent
├── packages/ide/       @schematics/ide
├── packages/server/    @schematics/server
├── examples/registry/  @schematics/examples
├── apps/playground/    Vite app
├── README.md
└── package.json        private workspace command runner
```

Any temporary compatibility package should remain outside the extractable
Schematics workspace.

## Package Responsibilities

| Package    | Responsibility                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| `core`     | Workspace DSL, JSON/YAML codecs, validation, reflection, diagnostics, virtual filesystem helpers.          |
| `protocol` | OpenRouter-compatible chat schemas, model/health schemas, tool schemas, and the Effect `HttpApi` contract. |
| `agent`    | Effect AI tools/toolkit, workspace tool runtime, schema-driven tool calls, chat adapters.                  |
| `react`    | `<Schematics />`, file tree, editing surface, diagnostics/debug panels, chat timeline.                     |
| `server`   | Standalone Effect HTTP server implementing the protocol contract and proxying to OpenRouter.               |
| `ui`       | Local Button, Badge, ScrollArea, Textarea, and `cn` primitives.                                            |
| `examples` | Neutral survey and workflow fixtures for playgrounds/tests.                                                |

Dependency direction stays one-way:

```
playground ──▶ react ──▶ core
     │          │  │
     │          │  └──▶ ui
     │          └────▶ agent ──▶ protocol
     └────────────────▶ server ─▶ protocol

examples ─────────────▶ core
```

## HTTP Surface

`@schematics/protocol` owns the contract; `@schematics/server` implements it.

| Method | Path              | Body                         | Response                                   |
| ------ | ----------------- | ---------------------------- | ------------------------------------------ |
| POST   | `/v1/chat`        | `{ model, messages, tools }` | OpenAI-compatible chat completion response |
| POST   | `/v1/chat/stream` | same                         | `text/event-stream` SSE relay              |
| GET    | `/v1/models`      | none                         | `{ models: { id, label }[] }`              |
| GET    | `/v1/healthz`     | none                         | `{ ok: true }`                             |

The server reads `SCHEMATICS_OPENROUTER_API_KEY` or `OPENROUTER_API_KEY`. Clients talk to the server without receiving the upstream key.
If no key is present in local development, the server starts with a local debug responder so the playground can still exercise the HTTP adapter and chat UI in isolation.

## Implemented

- Split package manifests for `core`, `protocol`, `agent`, `react`, `server`, `ui`, and `examples`.
- Final package-local names and imports use `@schematics/*`.
- Local UI primitives replace host design-system imports.
- Neutral fixtures live in `@schematics/examples`.
- The playground imports split packages directly and talks to `/v1` through a Vite proxy.
- The standalone server boots with `pnpm --dir packages/server dev`.
- The standalone server exposes a built `schematics-server` binary through `@schematics/server`.
- The combined local command boots server plus playground with `pnpm dev`.
- The built standalone server can serve the built playground and `/v1` API from one Node process with `pnpm serve`.
- The standalone server can boot without an OpenRouter key for package-local debug chat.
- Agent chat adapters default to package-local `/v1` endpoints rather than host application proxy routes.
- The package-local Turbo scripts use `turbo.standalone.json` so the copied-out package can run independently while the nested `turbo.json` remains valid for the host monorepo.
- Temporary host compatibility remains outside the extractable Schematics workspace.
- Package-local tests exist for every split package.
- Raw single-schema editing supports controlled values and honors the selected JSON/YAML surface independent of filename.
- A copied-out Schematics workspace installs, formats, tests, typechecks,
  builds, builds the playground, and serves `/` plus `/v1` without the host
  repository.
- The extractable CI workflow runs `serve:smoke` so the single-process UI and HTTP path remains covered.

## Remaining

- After packages are published, update the host application to consume versioned `@schematics/*` packages and remove the temporary compatibility package.
- Defer host route cleanup or host `/schematics` integration until the isolated package has its own published artifact or deploy target.

## Blocked External Steps

- **Deployed playground URL**: this is a post-extraction publication step, not an in-repo package implementation requirement. The extractable tree includes `.github/workflows/playground-pages.yml`, but that nested workflow is inert inside the Open Ontology monorepo. `gh api repos/bjacobso/open-ontology/pages` returns 404, so there is no active Pages site to cite. The PR preview URL serves the host Open Ontology app, not the isolated package playground, so it should not be listed as the Schematics playground URL. Add the concrete URL to the extracted workspace README only after the tree is copied to a standalone repository with GitHub Pages enabled, or after an explicit package-only deploy target is approved for this monorepo.
- **Published package consumption**: host application rewiring is deferred until versioned `@schematics/*` packages exist. The current user boundary is to avoid Open Ontology host wiring and keep this phase isolated.

## Extraction Checklist

- [x] No host-scoped package imports under the extractable Schematics workspace.
- [x] No host-scoped package names under the extractable Schematics workspace.
- [x] Compatibility package moved outside the extractable tree.
- [x] `@schematics/core` builds with only `effect` and `yaml` runtime dependencies.
- [x] `@schematics/server` boots standalone with `pnpm --dir packages/server dev`.
- [x] `apps/playground` runs against the standalone server with `pnpm dev`.
- [x] `pnpm serve` serves the built playground and standalone `/v1` API together.
- [x] `@schematics/ide` imports only Schematics packages and OSS dependencies.
- [x] Each split package has package-local smoke tests.
- [x] Each split package README has a short purpose statement and usage example.
- [x] Root README has a pitch, architecture diagram, package list, and usage example.
- [x] Extractable tree has its own `pnpm-workspace.yaml`.
- [x] Extractable tree has its own `tsconfig.base.json`, and split packages extend it.
- [x] Extractable tree has a CI workflow, license, contribution guide, and issue templates.
- [x] Extractable tree has a GitHub Pages workflow for publishing the package-local playground.
- [x] Copied-out extractable tree passes install, format, test, typecheck, build, playground build, and serve smoke.
- [x] Extractable tree has an automated `serve:smoke` check in CI.

## Post-Extraction Publication Checklist

- [ ] A deployed playground URL is in the README after a real standalone deploy exists.

## Verification Commands

```bash
pnpm install --frozen-lockfile
pnpm format
pnpm test --filter '@schematics/*'
pnpm typecheck --filter '@schematics/*'
pnpm build --filter '@schematics/*'
pnpm turbo run test --filter='...[origin/main]' --filter='!@open-ontology/language-ocaml...'
pnpm playground:build
pnpm install --frozen-lockfile
pnpm test --filter '@schematics/*'
pnpm typecheck --filter '@schematics/*'
pnpm build --filter '@schematics/*'
pnpm serve:smoke
```

The host repository should also verify its compatibility package until published packages replace the workspace dependency.
