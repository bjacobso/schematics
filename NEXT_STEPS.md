# Next Steps: Finish The Artifact-First Cutover

This is the concrete execution plan after the current artifact-project cleanup.
`PLAN.md` is the long-form vision. This file is the short, ordered engineering
path for getting Schema IDE fully onto artifacts without reintroducing a
workspace-shaped runtime under a new name.

## Current Baseline

The PR is now artifact-project first in the places that matter for greenfield
authoring:

- `@schema-ide/artifacts` owns artifact declarations, refs, matchers, handlers,
  registries, stores, and project declarations.
- `@schema-ide/core` exposes `Artifacts.runtime(...)` and
  `Artifacts.validate(...)`.
- First-party CLI config loading is project-named:
  `loadSchemaIdeProjectConfig`, `validateProjectDirectory`, and
  `serveSchemaIdeProject`.
- First-party example directories are under `projects/`, not `workspaces/`.
- Prompt-evals are intentionally removed from this migration surface for now.
- Onboarded is the reference serializable artifact project:
  `packages/onboarded-config/projects/onboarded-account-yaml/artifact-project.yaml`.
- PDF files now have a first-class non-schema artifact route and `inspect`
  view in the Onboarded project.

The remaining workspace concepts are mostly compatibility or transport:

- `Workspace.Struct` still exists as deprecated compatibility sugar.
- `SchemaIdeArtifactProjectService`, `SchemaIdeArtifactProjectRpcGroup`,
  `ArtifactProjectStateSnapshot`, and related artifact-project protocol names
  are now the first-party TypeScript surface. Workspace-named protocol exports
  remain only as compatibility aliases over the same wire contract.
- React implementation files are artifact-project named:
  `SchemaIdeArtifactProjectView`, `artifact-project-client`,
  `artifact-project-store`, and `artifact-project-tool-runtime`.
- The CLI still keeps `local-workspace-client.ts` as an implementation filename,
  but exposes `createLocalFilesystemArtifactProjectClient(...)` as the
  greenfield public name.
- Core still contains a workspace decode path and compatibility projection
  helpers.
- Runtime clients now use artifact-store transitions for writes, while
  `applyWorkspaceChange` and related workspace history helpers live under
  `@schema-ide/core`'s explicit `Legacy` namespace and remain as deprecated
  top-level compatibility exports.
- `ArtifactProjectDeclaration.projectType` is now the root project artifact
  type. `workspaceType` remains only as a deprecated compatibility getter.

## Guardrails

- New authoring APIs should accept `ArtifactProject` or project config, not
  `Workspace.Struct`.
- Keep prompt-evals out until there is an explicit named project-level view and
  handler design. Do not bring back arbitrary whole-project transform as a core
  primitive.
- Preserve protocol compatibility until the artifact protocol replacement is
  tested end to end.
- Every phase should end with at least one deletion or visible compatibility
  reduction.
- Keep `schema-algebra` as the semantic layer over decoded artifact values. Do
  not move relation graph logic into artifact routing or CLI glue.

## Phase 1: Collapse Runtime Validation

Goal: one validation/reflection path, routed through artifacts.

Status: implemented. `StructWorkspaceSchema.decode(...)` now creates a
temporary artifact project from reflected route declarations and calls the shared
artifact-project decoder. The old field-level decode methods were deleted.
`Workspace.validate(...)` and `Workspace.transform(...)` remain as compatibility
wrappers around that artifact-routed decode result.

Work:

- [x] Route `validateSchemaIdeValue(...)` through artifact routing when the input
      is a `WorkspaceSchema` declaration.
- [x] Keep `Workspace.Struct` as declaration compatibility, but stop treating it as
      an independent runtime engine.
- [x] Move duplicated decode behavior out of `StructWorkspaceSchema.decode` and
      `FileSetSchema.decode` once artifact parity is proven.
- [x] Add focused tests asserting that `Artifacts.validate(...)`,
      `validateProjectDirectory(...)`, and `Workspace.Struct` validation return the
      same reflection for the same files.

Exit criteria:

- There is one project decode implementation.
- Workspace schema decode is either deleted or only delegates to artifact
  project decode.
- Core, CLI, examples, Onboarded, React, agent, and protocol tests stay green.

## Phase 2: Make ArtifactStore The Write Engine

Goal: writes, watches, and history sit on artifact refs instead of workspace
file arrays.

Status: implemented. `@schema-ide/artifacts` now exposes
`createVersionedArtifactStore(...)`, artifact-ref changes, revision metadata,
history state, undo, and redo. The in-memory artifact store now publishes watch
events for create, update, and delete. React memory/project clients now apply
writes through the versioned artifact store. CLI local filesystem and
Cloudflare writes use the artifact store as the state transition engine and then
persist the resulting file projection.

Work:

- [x] Introduce a versioned artifact-store wrapper that handles revision
      history, labels, undo, and redo.
- [x] Add artifact-ref undo/redo semantics for write, create, delete, and
      replace changes.
- [x] Make memory-store watch behavior first-class and deterministic.
- [x] Repoint React memory/project clients through the artifact store layer.
- [x] Repoint CLI local filesystem client and Cloudflare DO writes through the
      artifact store layer.
- [x] Keep path-based `SourceFile` snapshots only as a projection for current UI
      and protocol consumers.

Exit criteria:

- `applyWorkspaceChange` is isolated to legacy core compatibility exports and
  tests.
- Undo/redo tests pass through the artifact-store wrapper.
- Local filesystem and Cloudflare write tests still cover create, replace,
  rename, delete, and external watch refresh.

## Phase 3: Collapse React Clients

Goal: one React service client backed by artifacts.

Status: implemented. React now exposes `createSchemaIdeArtifactClient(...)` as
the single artifact-backed service-client factory. The previous
`createArtifactWorkspaceClient(...)`, `createProjectWorkspaceClient(...)`, and
`createMemoryWorkspaceClient(...)` names were deleted. `<SchemaIde project={...}
/>`, `<SchemaIde schema={...} />`, the playground, tests, and
`SchemaIdeArtifactProjectView` now construct clients through the artifact-first
factory. Schema props are compatibility input that immediately becomes an
artifact-backed service client instead of a component-local legacy-history
runtime.

Work:

- [x] Make the store-backed artifact client the single implementation.
- [x] Collapse memory/project/artifact client creation into
      `createSchemaIdeArtifactClient(...)`.
- [x] Keep `<SchemaIde project={...} />` as the primary React entrypoint.
- [x] Delete or isolate the previous memory/project workspace client names once
      downstream compatibility no longer needs them.
- [x] Move `SchemaIdeSchemaMode` onto the same store-backed artifact client path
      so `schema` props are only compatibility input that internally becomes an
      artifact project.

Exit criteria:

- One client factory handles project, memory, and local-backed modes.
- React no longer branches between workspace and artifact runtime paths.
- React tests prove a project-only app can validate, edit, preview, and chat.

## Phase 4: Pull Reflection As A View

Goal: snapshots describe state changes; artifact views describe
interpretations.

Work:

- [x] Keep the current protocol envelope until clients are migrated, but stop making
      `snapshot.reflection` the required source of truth.
- [x] Teach React store hydration to request the root `reflection` artifact view
      when it needs reflection.
- [x] Add or rename a project snapshot shape once reflection is no longer embedded
      in every pushed event.
- [x] Split artifact watch events from workspace snapshot events instead of aliasing
      them.

Exit criteria:

- Reflection is pulled on demand through an artifact project view.
- Watch events can be generated from artifact store events.
- The existing workspace RPC can remain as a compatibility wrapper, but it no
  longer dictates the runtime model.

## Phase 5: Ship One Non-Schema Artifact View

Goal: prove artifacts are more than schema-routed JSON/YAML files.

Work:

- [x] Add a real `pdf` artifact type with at least one handler-backed view.
- [x] Prefer Onboarded PDF inspection as the first target:
      `packages/onboarded-config/projects/onboarded-account-yaml/files/documents/client-safety-packet`.
- [x] Replace or reduce the generated PDF sidecar dependency with a declared view
      such as `inspect`, `annotations`, or `pageImages`.
- [x] Surface that capability through `get_artifact_capabilities` and
      `read_artifact_view`.

Exit criteria:

- A non-schema artifact view runs declaration -> capability -> handler -> UI or
  agent tool.
- The core package does not grow heavy PDF dependencies; implementation lives in
  an optional package or package-local handler.

## Phase 6: Rename Protocol And Compatibility Spine

Goal: artifact/project names become the public service language.

Work:

- [x] Rename protocol/service types after the runtime no longer depends on the
      workspace model:
      `SchemaIdeArtifactProjectService`, `SchemaIdeArtifactProjectRpcGroup`,
      `ArtifactProjectStateSnapshot`, and related event names.
- [x] Rename React implementation files and exported view names only after the
      client collapse is done.
- [x] Rename `ArtifactProjectDeclaration.workspaceType` to a root/project-level
      term once call sites are small enough.
- [x] Move workspace-only compatibility helpers into an explicit legacy module.

Exit criteria:

- Public docs and package APIs teach artifact projects as the only greenfield
  model.
- Workspace-named exports are either gone or isolated as compatibility.
- The protocol compatibility wrapper is thin and tested.

## Phase 7: Revisit Deferred Project-Level Views

Goal: decide whether prompt-evals or other whole-project interpretations belong
as explicit project views.

Work:

- Do not restore `Workspace.transform(...)`.
- Model any whole-project interpretation as a named project view with input,
  output, error schema, policy, and handler.
- Use a concrete example before adding a generic planning/conversion pipeline.

Exit criteria:

- If prompt-evals return, they return as an artifact project with explicit
  project-level views.
- No hidden transform pipeline is required for normal artifact routing.

## Suggested Order

1. Phase 1: collapse validation.
2. Phase 2: artifact-store writes and history.
3. Phase 3: one React client.
4. Phase 4: reflection as a pulled view.
5. Phase 5 can run in parallel once a small handler target is selected.
6. Phase 6 should wait until the runtime and client are already artifact-native.
7. Phase 7 waits for a real whole-project view use case.

## Verification Checklist Per Phase

- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- Focused package checks for every touched package.
- `git diff --check`
- A search pass for accidentally reintroduced prompt-eval or workspace-first
  authoring names.

## Definition Of Done

- Greenfield apps configure Schema IDE with artifact projects, not workspaces.
- Validation, reflection, relation graphs, diagnostics, preview data, and agent
  tools all read artifact views.
- Writes and history are artifact-store concerns.
- Protocol workspace naming is either gone or explicitly compatibility-only.
- At least one non-schema artifact handler ships end to end.
