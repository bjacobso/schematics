# Plan: Workspace Artifacts, Tool Runtimes, and Dependency Graphs

Schema IDE should be able to understand generated files as first-class
workspace artifacts without weakening its core contract: the Effect Schema is
the agreement between human, agent, and runtime for editable workspace state.

A workspace should be able to declare which files are source material, which
files are generated, which tools produce generated artifacts, and what upstream
artifacts a tool depends on. From those declarations Schema IDE can derive a
dependency graph for validation context, previews, agent policy, and optional
local workflow execution.

This is the reusable primitive behind pipelines such as:

```text
source HTML
  -> screenshots
  -> Markdown document
  -> structured JSON
  -> generated PDF
  -> PDF field metadata
```

The primitive should over-index on document conversion workflows: HTML to
Markdown, HTML to PDF, screenshots as visual ground truth, generated structured
documents, and PDF field metadata. Consumer packages add source-system context,
domain schemas, prompts, previews, and runtime implementations.

## Goals

- Capture generated files in workspace config without making them durable source
  of truth.
- Describe which named tools consume and produce each artifact.
- Plug in tool implementation logic from a host package or runtime adapter.
- Derive a dependency graph from artifact and tool declarations.
- Let the IDE answer what is stale, missing, runnable, blocked, or affected by
  a source change.
- Let agents call only declared tools and write only declared outputs when a
  workspace chooses that policy.
- Reuse the same graph for local UI actions, CLI workflow commands, and runtime
  execution.

## Non-Goals

- Do not bake source-system, product-domain, model-provider, browser-renderer,
  or PDF-library logic into `@schema-ide/core`.
- Do not replace schema-routed file validation. The existing workspace schema
  remains the contract for durable editable files.
- Do not require every generated file to have an Effect Schema route.
- Do not make command execution mandatory. Some tools may be agent-only,
  remote-service backed, or provided by a host application.

## Concept Model

There are four layers:

```text
workspace schema
  validates editable source/config files

artifact graph
  names source files, generated outputs, and per-entity dependencies

schema-algebra graph
  describes semantic relations inside decoded workspace values

tool runtime
  executes declared operations that produce artifacts
```

The workspace schema answers "is this file valid?" The artifact graph answers
"where did this file come from and what depends on it?" The runtime answers
"how do I generate it here?"

The artifact graph and schema-algebra graph are sibling axes:

- schema-algebra describes relationships inside schema-routed values, such as
  document sections, field references, policy references, account scopes, and
  safe renames
- the artifact graph describes file provenance and generated-output
  dependencies, such as screenshots, Markdown documents, PDFs, and reports

They should be able to interoperate through file routes and schema IDs, but one
should not subsume the other. For example, a `structured-document` artifact can
point at a schema route, and schema-algebra can then answer which downstream
references depend on sections or fields inside that generated or promoted file.

## Proposed Config Shape

```ts
import { defineSchemaIdeWorkspace } from "@schema-ide/cli";
import { DocumentWorkspaceSchema } from "./workspace";

export default defineSchemaIdeWorkspace({
  id: "html-document-conversion",
  schema: DocumentWorkspaceSchema,
  // Applies to schema-routed editable files, not binary/generated artifacts.
  defaultFormat: "json",
  include: ["documents/**/*.json", "prompts/**/*.json"],

  artifacts: [
    {
      id: "source-html",
      kind: "source",
      path: "sources/:collection/:document/*.html",
      entity: ["collection", "document"],
      contentType: "text/html",
    },
    {
      id: "screenshots",
      kind: "generated",
      path: "generated/:collection/:document/screenshots/page-*.png",
      entity: ["collection", "document"],
      contentType: "image/png",
    },
    {
      id: "markdown",
      kind: "generated",
      path: "generated/:collection/:document/document.md",
      entity: ["collection", "document"],
      contentType: "text/markdown",
    },
    {
      id: "structured-document",
      kind: "generated",
      path: "generated/:collection/:document/document.json",
      entity: ["collection", "document"],
      schemaId: "StructuredDocuments",
      policy: "read-only",
    },
    {
      id: "pdf",
      kind: "generated",
      path: "generated/:collection/:document/document.pdf",
      entity: ["collection", "document"],
      contentType: "application/pdf",
    },
    {
      id: "pdf-fields",
      kind: "generated",
      path: "generated/:collection/:document/pdf-fields.json",
      entity: ["collection", "document"],
      contentType: "application/json",
    },
  ],

  tools: [
    {
      id: "render-html-screenshots",
      label: "Screenshots",
      inputs: ["source-html"],
      outputs: ["screenshots"],
    },
    {
      id: "extract-markdown",
      label: "Markdown document",
      inputs: ["screenshots"],
      outputs: ["markdown"],
      model: true,
      uiCallable: true,
      cliCallable: true,
    },
    {
      id: "structure-document",
      label: "Structured document",
      inputs: ["source-html", "screenshots", "markdown"],
      outputs: ["structured-document"],
      model: true,
    },
    {
      id: "render-pdf",
      label: "Generated PDF",
      inputs: ["source-html"],
      outputs: ["pdf"],
    },
    {
      id: "inspect-pdf-fields",
      label: "PDF field metadata",
      inputs: ["pdf"],
      outputs: ["pdf-fields"],
    },
  ],
});
```

Generated artifact ownership is derived from `tools[].outputs`. The initial
shape intentionally avoids a separate `generatedBy` field so provenance has one
source of truth. If alternate producer preference becomes a real requirement,
add a `preferredProducer` field later and validate it against the derived graph.

## Type Sketch

```ts
export interface SchemaIdeWorkspaceArtifact {
  readonly id: string;
  readonly kind: "source" | "generated";
  readonly path: string | readonly string[];
  readonly entity?: readonly string[];
  readonly description?: string;
  readonly contentType?: string;
  readonly schemaId?: string;
  readonly optional?: boolean;
  readonly policy?: "read-only" | "promotable" | "editable";
  readonly staleWhen?: readonly string[];
}

export interface SchemaIdeWorkspaceTool {
  readonly id: string;
  readonly label?: string;
  readonly description?: string;
  readonly inputs?: readonly string[];
  readonly outputs?: readonly string[];
  readonly capability?: string;
  readonly parametersSchemaId?: string;
  readonly resultSchemaId?: string;
  readonly model?: boolean;
  readonly agentCallable?: boolean;
  readonly uiCallable?: boolean;
  readonly cliCallable?: boolean;
  readonly requiresApproval?: boolean;
  readonly destructive?: boolean;
  readonly timeoutMs?: number;
}

export interface SchemaIdeWorkspaceConfig<A, Routes> {
  readonly id?: string;
  readonly schema: SchemaIdeInputSchema<A, Routes>;
  readonly defaultFormat?: SchemaIdeDocumentFormat;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly artifacts?: readonly SchemaIdeWorkspaceArtifact[];
  readonly tools?: readonly SchemaIdeWorkspaceTool[];
}
```

This can start in the CLI/product config surface. Core workspace schemas should
not need to know about command execution.

## Package Boundaries

The graph should be pure data first.

- `@schema-ide/core` should own artifact/tool config types, path-template
  parsing, static graph derivation, and graph validation. It should not run
  tools, touch the filesystem, or import Effect AI Toolkit.
- `@schema-ide/cli` should own local filesystem matching, content
  fingerprinting, status calculation, and read-only graph/status commands.
- `@schema-ide/react` should render graph/status data and invoke runtime actions
  through the workspace client only.
- `@schema-ide/protocol` should own RPC schemas for graph/status/run operations
  once execution crosses a process boundary.
- `@schema-ide/agent` should bind agent-facing tools to graph inspection,
  approval policy, and optional runtime execution. Effect AI Toolkit belongs
  here or in domain packages, not in core.

This keeps the reusable contract aligned with Schema IDE's existing package
shape: core validates and reflects state, while agent/server/cli provide
runtime behavior around that state.

## Consumer Package Context

The reusable Schema IDE primitive should not know what source system produced
the HTML, what product domain will consume the generated PDF, or what prompts
should be used for Markdown extraction. A consumer package should provide that
context:

- source-system vocabulary and directory conventions
- domain schemas and schema IDs for structured generated files
- prompts and model defaults for Markdown or structure extraction
- preview components for source HTML, screenshots, Markdown, PDFs, and reports
- runtime handlers that know which renderer, PDF library, or model provider to
  use

The core artifact/tool graph should remain a reusable document-conversion
primitive that those packages configure.

## Runtime Plug-In

The config declares what can happen. A runtime provides how it happens. Tool
execution is optional: a workspace can expose the graph and status without
registering any executable handlers.

Use Effect AI Toolkit for in-process tool contracts and handlers, then expose
tool execution through workspace RPC for UIs, servers and CLIs.

The layers should stay separate:

```text
workspace config
  declares artifacts, tools, and graph edges

Effect AI Toolkit
  defines typed tool parameters, results, and local handlers

Workspace RPC
  exposes getGraph, getStatus, runTool, and run events across processes
```

The graph itself should not be modeled as AI tools. It is workspace metadata.
Only execution of declared tools needs Toolkit handlers or RPC dispatch.

```ts
import { Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";

export const ExtractMarkdownTool = Tool.make("extract_markdown", {
  description: "Generate Markdown from rendered document screenshots.",
  parameters: Schema.Struct({
    target: Schema.String,
    model: Schema.optional(Schema.String),
    force: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({
    path: Schema.String,
    pageCount: Schema.Number,
    warnings: Schema.Array(Schema.String),
  }),
  failure: Schema.Struct({
    message: Schema.String,
  }),
  failureMode: "return",
});

export const DocumentConversionToolkit = Toolkit.make(ExtractMarkdownTool);
```

Tool declarations can point at Toolkit contracts without requiring the config to
import implementation code:

```ts
tools: [
  {
    id: "extract-markdown",
    label: "Markdown document",
    capability: "document-conversion.extract-markdown",
    inputs: ["screenshots"],
    outputs: ["markdown"],
    model: true,
    agentCallable: true,
    uiCallable: true,
    cliCallable: true,
    requiresApproval: true,
  },
];
```

An in-process runtime can map capability IDs to Toolkit handlers:

```ts
export const runtime = defineWorkspaceToolRuntime({
  handlers: {
    "document-conversion.extract-markdown": ExtractMarkdownTool.toHandler((params) => {
      // Read screenshots and write document.md.
    }),
  },
});
```

The runtime context should include:

- workspace root
- selected entity or file, if any
- current files and reflection
- matched input artifact files
- expected output artifact paths, when derivable
- content fingerprints for matched inputs and existing outputs
- parameters supplied by UI, CLI, or agent
- model configuration, when the tool is model-backed
- logging, progress, and cancellation hooks

The runtime result should include:

- status: `passed | failed | skipped | blocked`
- files read and files written
- artifact records
- diagnostics or validation summary
- warnings and errors
- content fingerprints for written outputs
- timing, attempts, usage, cost, and trace metadata when available

Runtime availability should be explicit:

```ts
export interface WorkspaceRuntimeCapabilities {
  readonly capabilities: readonly string[];
}
```

If a declared tool has no registered runtime capability, the graph should still
show it. Status and UI surfaces should mark it `unavailable` and explain that no
runtime is registered.

## Workspace RPC

Workspace RPC is the boundary for anything outside the process that owns the
tool implementation. React should not import a consumer converter package just
to run a tool, and a hosted workspace should be able to delegate execution to a
worker, service, desktop process, or CI runner.

Initial RPC shape:

```ts
export interface WorkspaceToolRpc {
  readonly getToolGraph: () => Effect.Effect<WorkspaceToolGraph>;
  readonly getToolStatus: (request: ToolStatusRequest) => Effect.Effect<ToolStatusResult>;
  readonly runTool: (request: RunToolRequest) => Effect.Effect<RunToolResult>;
  readonly watchToolRuns: () => Stream.Stream<ToolRunEvent>;
}

export interface RunToolRequest {
  readonly toolId: string;
  readonly target?: string;
  readonly parameters?: unknown;
  readonly model?: string;
  readonly outputRoot?: string;
  readonly dryRun?: boolean;
}
```

The RPC implementation can dispatch to:

- an in-process Effect AI Toolkit layer
- a local command runner
- a long-lived worker process
- a hosted workflow service

All of those adapters should return the same run result shape and write the
same run records.

## Derived Graph

Given artifact and tool declarations, Schema IDE can derive a graph:

```text
source-html
  -> render-html-screenshots
  -> screenshots
  -> extract-markdown
  -> markdown
  -> structure-document
  -> structured-document

source-html
  -> render-pdf
  -> pdf
  -> inspect-pdf-fields
  -> pdf-fields
```

Nodes:

- artifact nodes: `source-html`, `screenshots`, `markdown`, `pdf`
- tool nodes: `render-html-screenshots`, `extract-markdown`, `render-pdf`
- optional file nodes for concrete matched files

Edges:

- artifact to tool: tool consumes artifact
- tool to artifact: tool produces artifact
- file to artifact: file matches artifact declaration
- schema route to artifact: artifact is also schema-routed, when `schemaId` is set

The first implementation can derive graph structure at artifact/tool id level.
Path-template binding should be part of the first design pass, even if the first
implementation only reports coarse artifact-level status. Without entity keys
such as `collection` and `document`, the graph cannot answer per-file questions
like "is this document's Markdown stale?" or "what must run before this one PDF
can be generated?"

Initial template rules:

- `:name` captures one path segment.
- `*` matches a wildcard segment or filename suffix but does not define an
  entity key.
- An artifact's `entity` list names the captures that bind concrete source and
  output files together.
- Tool inputs and outputs are matched per entity key set. For example, a
  `extract-markdown` run for `{ collection: "policies", document: "safety" }`
  consumes screenshots with the same entity binding and writes the matching
  Markdown artifact.

## Status Queries

The graph should support these questions:

- Which tool generated this file?
- Which generated artifacts are missing?
- Which tools are runnable now?
- Which tools are blocked by missing inputs?
- Which outputs are stale after a source file changes?
- What downstream artifacts will be invalidated if this file changes?
- What files did this tool write last time?
- Which generated files are unmanaged by any declared tool?
- Which declared outputs are not included in the workspace file set?

Initial status model:

```ts
type ArtifactStatus = "present" | "missing" | "stale" | "unmanaged";

type ToolAvailability = "runnable" | "blocked" | "unavailable";

type ToolRunStatus = "running" | "passed" | "failed" | "skipped";
```

Staleness can start conservative:

- If an output is missing, it is missing.
- If a required input is missing, the tool is blocked.
- If an input content fingerprint differs from the fingerprint captured by the
  output's latest run record, the output is stale.
- If no fingerprint is available, fall back to mtime only as an advisory local
  filesystem heuristic.
- Mtime should not be the default because worktrees, CI caches, and git
  checkouts make it unreliable in the environments Schema IDE targets.

## Run Records

Generated workflow execution should produce a small run record. This lets the
IDE inspect historical outputs without re-running tools.

```json
{
  "id": "run_2026_05_22_001",
  "tool": "extract-markdown",
  "status": "passed",
  "startedAt": "2026-05-22T17:00:00.000Z",
  "endedAt": "2026-05-22T17:00:07.000Z",
  "inputs": [
    { "artifact": "screenshots", "path": "generated/policies/safety/screenshots/page-01.png" }
  ],
  "outputs": [{ "artifact": "markdown", "path": "generated/policies/safety/document.md" }],
  "validation": {
    "valid": true,
    "errorCount": 0,
    "warningCount": 0,
    "infoCount": 0
  },
  "warnings": [],
  "errors": [],
  "usage": {
    "calls": 1,
    "inputTokens": 1000,
    "outputTokens": 500
  }
}
```

Run records are not the source of truth. They are operational metadata for
debugging, stale checks, and IDE reports.

Future eval tooling can consume the same graph and run-result shapes, but eval
suites, judges, baselines, and immutable case records are deliberately deferred.
They should be designed after artifact matching, status, and runtime execution
are stable.

## Agent Policy

Tool declarations should become part of the agent contract.
Agent-visible tools should reuse the same Effect AI Toolkit contracts as local
runtime tools when possible. That keeps parameter schemas, result schemas,
validation, and failure behavior aligned between direct agent calls and
workspace RPC execution.

Recommended defaults:

- Agents can read source and generated artifacts through normal workspace tools.
- Agents can only run tools with `agentCallable: true`.
- Agents can only write declared outputs for the tool they are running.
- Agent-created generated files should include a run record.
- Direct edits to generated artifacts should be allowed only when the artifact
  opts in, or when the user explicitly approves the patch.
- If a tool is not available in-process, the agent calls `runTool` through the
  workspace RPC service instead of receiving shell access.
- Tools marked `requiresApproval` should produce a proposed run or patch in plan
  mode unless the user explicitly approves execution.
- UI and CLI surfaces should only run tools marked `uiCallable` and
  `cliCallable`, respectively.
- Model-backed tools should support workspace-level cost, model, timeout, and
  output policy limits.
- Generated outputs default to read-only. Promotion into schema-routed source
  should be a separate explicit action, not an accidental edit to `output/**`.

This gives the agent a clear operational contract:

```text
read workspace
inspect graph
run declared tool
write declared outputs
validate workspace
report diagnostics and run metadata
```

## UI Surfaces

The React UI can use the graph for:

- generated/source badges in the file tree
- "Generated by" detail on file preview
- missing/stale output warnings
- "Run upstream", "Run this tool", "Run stale outputs", and "Run downstream"
  actions when a runtime is registered
- disabled run actions with an unavailable-runtime explanation when no handler
  is registered
- run logs, progress, result summaries, and written-output links
- artifact previews for source HTML, Markdown, PDF, image, JSON, and
  schema-routed text files
- graph view by artifact and tool

These UI pieces should be optional. A basic schema editor should not need to
configure artifacts or tools.

## CLI Surface

Possible commands:

```sh
schema-ide artifacts --schema ./schema-ide.config.ts --dir . --json
schema-ide graph --schema ./schema-ide.config.ts --dir . --json
schema-ide status --schema ./schema-ide.config.ts --dir . --json
schema-ide run --schema ./schema-ide.config.ts --dir . --tool extract-markdown --target policies/safety
schema-ide run --schema ./schema-ide.config.ts --dir . --stale
```

The initial CLI can start read-only:

- list artifact definitions
- list matched files
- print graph
- report missing outputs and blocked tools

Execution should become available once the runtime registry exists. If no
handler is registered for a declared tool, `schema-ide run` should fail with an
unavailable-runtime diagnostic rather than falling back to arbitrary shell
execution.

## Implementation Phases

### Phase 1: Config and Static Graph

- Add `artifacts` and `tools` fields to workspace config types.
- Add path-template syntax and entity-key binding to artifact declarations.
- Validate duplicate artifact IDs and duplicate tool IDs.
- Validate that every tool input/output references a known artifact.
- Derive producer ownership from `tools[].outputs`.
- Derive an artifact/tool graph.
- Add CLI `graph` or `artifacts` inspection output.

### Phase 2: File Matching and Status

- Match source files to artifact definitions.
- Report present, missing, unmanaged, and blocked status.
- Add generated/source badges to the file tree.
- Add status data to workspace reflection or a companion graph reflection.

### Phase 3: Runtime Adapter

- Define `SchemaIdeToolRuntime`.
- Reuse Effect AI Toolkit definitions for in-process tool contracts.
- Let workspace tool declarations reference stable capability IDs.
- Let local filesystem workspaces register runtime handlers.
- Add workspace RPC methods for graph, status, run, and run-event streaming.
- Add runtime availability to tool status.
- Add run records and progress events.
- Add CLI and React actions for running declared tools.
- Ensure `runTool` writes only declared outputs and returns an unavailable
  result when no runtime handler is registered.

### Phase 4: Agent Integration

- Expose graph inspection tools to the agent.
- Let agents run declared `agentCallable` tools.
- Enforce the same runtime availability, approval, and declared-output policy
  used by UI and CLI execution.

### Phase 5: Rich Document Assets

- Add Markdown and image document handling.
- Keep PDFs as binary workspace assets with PDF-specific previews and tools.
- Let artifact declarations choose preview and inspection behavior by
  `contentType` or explicit preview IDs.

## Open Questions

- How should path variables bind concrete source and output files together?
  The initial plan assumes `:segment` path templates plus `entity` keys, but the
  exact syntax and escaping rules still need implementation design.
- Should path-template matching compile down to the current glob helper, or
  should artifact matching use a separate parser?
- Should run records live under `.schema-ide/runs/`, a domain-specific output
  root, or a configurable path?
- Should generated artifacts be excluded from validation by default unless they
  also match a schema route?
- Should generated artifacts that also expose a `schemaId` be validated as
  read-only previews, or only after promotion into source workspace files?
- How much of `runTool` belongs in the baseline workspace protocol versus a
  local-filesystem/runtime extension?

## Design Principle

Keep validation pure and execution pluggable.

The schema defines valid workspace state. The artifact graph defines provenance
and dependencies. Runtime adapters execute tools in a particular environment.
That separation lets Schema IDE support PDFs, Markdown, screenshots, and agent
workflows without becoming a source-conversion framework.

## Deferred

Eval suites, judges, baselines, and immutable case records are deferred. They
can later consume artifact IDs, graph expansion, and run-result shapes once the
core graph, status, and runtime execution model is stable.
