# Vision: Effect Artifacts

What if files were not passive blobs, but typed artifacts that can describe their own available interpretations?

The idea behind `effect-artifacts` is a small Effect-native primitive for declaring the semantic surface area of any artifact: JSON, YAML, Markdown, PDF, image, video, generated output, remote blob, git object, or future media type. Each artifact type declares the views it can expose, the schemas for those views, and the handlers that can materialize them.

This is not just a registry of tools. It is a runtime-inspectable artifact language whose declarations are also executable contracts.

## Core Shape

The central abstraction is an `ArtifactApi`, analogous to `HttpApi`.

```text
ArtifactApi     ~= HttpApi
ArtifactType    ~= HttpApiGroup
ArtifactView    ~= HttpApiEndpoint
ArtifactHandler ~= endpoint handler
Schema          ~= input/output/error contract
Layer           ~= registered implementation
```

An artifact type is a declaration of what a class of artifacts can be:

```ts
const Pdf = ArtifactType.make("pdf")
  .match(ArtifactMatcher.extension("pdf"))
  .match(ArtifactMatcher.mime("application/pdf"))
  .view("markdown", {
    input: PdfMarkdownInput,
    output: PdfMarkdown,
    error: PdfError,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "text/markdown",
    },
  })
  .view("pageImages", {
    input: PdfPageImagesInput,
    output: PdfPageImages,
    error: PdfError,
    annotations: {
      cost: Cost.high,
      cache: CachePolicy.contentHash,
      mediaType: "image/png",
    },
  });
```

The declaration says:

- this is a PDF-shaped artifact
- it can be recognized by extension or MIME type
- it can expose a `markdown` view
- it can expose a `pageImages` view
- each view has typed input, output, and error contracts
- each view carries policy metadata like cost, cache, and media type

The handler is separate:

```ts
const PdfMarkdownHandler = ArtifactHandler.make(
  Pdf.view("markdown"),
  ({ ref }) => Effect.tryPromise(() => pdfToMarkdown(ref)),
);
```

That separation matters. The artifact API is the contract. Handlers are just replaceable implementations.

## Homoiconicity In TypeScript

The interesting property is that the declaration has the same module shape as the thing the agent needs to inspect.

The TypeScript module is not merely source code that builds a registry. The module is itself the artifact grammar:

```ts
export const Artifacts = ArtifactApi.make("workspace")
  .add(Pdf)
  .add(Json)
  .add(Yaml)
  .add(Video);
```

At runtime, the harness can inspect this value and recover the schema of the world:

```ts
const capabilities = ArtifactApi.capabilities(Artifacts, artifactRef);
```

That makes the module homoiconic in the practical TypeScript sense: the program that declares artifact meaning can be treated as data by the runtime that uses it. The artifact language is not mirrored into JSON, YAML, or comments. It is the same Effect Schema value graph that handlers, docs, validation, tools, and agents consume.

This is the same move that makes `HttpApi` powerful:

- the declaration is typed
- the declaration is inspectable
- the declaration can generate tools, docs, clients, and validators
- the declaration is separate from implementation
- the declaration can be composed as normal TypeScript modules

## Concept Network

### Artifact

An artifact is any addressable thing with interpretable content.

It might be a local path, a remote URL, an S3 object, an R2 blob, a git blob, a generated file, or an opaque handle owned by a host application.

The core package should not assume local filesystem semantics. A local file is one kind of artifact, not the primitive.

### Artifact Ref

An `ArtifactRef` is the stable handle passed through the system.

It should carry enough information for host-specific handlers to resolve the artifact without forcing every consumer into the same storage model.

Possible shapes:

```ts
{ _tag: "Path", path: string }
{ _tag: "Url", url: string }
{ _tag: "Blob", id: string }
{ _tag: "GitBlob", repo: string, oid: string }
```

The ref is the identity. Views are derived from it.

### Matcher

A matcher answers: "which artifact type declarations might apply to this ref?"

Examples:

- extension
- MIME type
- magic bytes
- URI scheme
- host-provided metadata
- schema probe

Matching should be cheap and layered. Extension matching is cheap. Magic byte inspection may require reading. Content probing may be expensive. The API should allow matchers to expose that cost.

### View

A view is a typed semantic projection over an artifact.

A PDF can expose:

- markdown
- page images
- embedded images
- metadata
- outline
- OCR text

A video can expose:

- transcript
- keyframes
- chapters
- audio waveform
- metadata

A JSON document can expose:

- parsed value
- inferred schema
- JSONPath query surface
- normalized tree
- diagnostics

The agent should not need to know how to parse every file type. It should ask the harness what views exist and choose the cheapest useful one.

### Handler

A handler materializes one view.

Handlers are Effect programs. That means they can require services, use layers, fail with typed errors, stream results, respect interruption, and compose with cache and policy services.

The same `markdown` view for PDFs could have multiple handlers:

- a fast local parser
- an OCR-backed parser
- a remote document intelligence service
- a host-provided proprietary extractor

The API declaration remains stable while implementations vary by environment.

### Registry

The registry is a composed set of artifact APIs and handlers.

It answers:

- what artifact types are known?
- which type matches this ref?
- what views are available?
- which handler can produce this view?
- what are the input, output, and error schemas?
- what policies apply before invoking the handler?

For an agent harness, this registry is the boundary between model reasoning and tool execution.

### Policy

Policy should be metadata on views, not bespoke logic hidden in handlers.

Useful policy dimensions:

- cost: low, medium, high
- cache: none, ref, content hash, explicit key
- privacy: local only, remote allowed, redaction required
- latency: interactive, background
- determinism: deterministic, best effort, model generated
- output size: bounded, potentially large, streamable

This lets an agent ask for the lowest-cost useful view first. It also lets a host block expensive or remote operations before a tool runs.

### Cache

Caching belongs at the harness layer, but the artifact declaration should say which cache semantics are valid.

Examples:

- cache by artifact identity
- cache by content hash
- cache by input parameters
- never cache
- cache only within a session

The handler should not have to own all of that policy.

### Agent Harness

The agent-facing API can stay small:

```ts
const caps = yield* artifacts.capabilities(ref);
const md = yield* artifacts.view(ref, "markdown");
const frames = yield* artifacts.view(ref, "keyframes", { every: "30s" });
```

The harness performs the mechanical work:

1. resolve the artifact ref
2. match artifact types
3. expose declared capabilities
4. validate view input
5. apply policy
6. call the handler
7. validate output
8. cache or index the result

The model reasons over capabilities. The harness executes contracts.

## Why This Matters For Schema IDE

Schema IDE already treats schemas as source artifacts that can be parsed, reflected, validated, displayed, edited, and used by an agent.

`effect-artifacts` generalizes that move.

Instead of special-casing "schema files" as the only inspectable units, every file can declare a typed surface area. A schema module is one artifact type. A PDF is another. A video is another. A generated report is another.

The IDE and agent can then ask the same questions everywhere:

- what is this?
- what views can it expose?
- what schemas describe those views?
- what tools can materialize them?
- what will it cost?
- is it cacheable?
- can I inspect the declaration before invoking the tool?

This turns the workspace into a graph of typed, inspectable, executable artifact declarations.

## Relationship To Schema IDE Today

Schema IDE should be the first host for the artifact model, not a thing replaced
by it.

Today, the project already has most of the pieces for one artifact family:

```text
SourceFile path/content
  -> workspace route
  -> parsed JSON/YAML value
  -> Effect Schema validation
  -> reflection
  -> diagnostics
  -> schema algebra graph
  -> agent tools
```

`effect-artifacts` names that shape explicitly:

```text
SourceFile path/content
  -> ArtifactRef.WorkspaceFile or ArtifactRef.Path
  -> ArtifactType Json/Yaml/SchemaModule
  -> views parsedValue/diagnostics/reflection/relationGraph/jsonSchema
  -> handlers backed by existing core and schema-algebra functions
```

This keeps the current workspace model intact while giving the UI and agent a
smaller question to ask everywhere:

```ts
const caps = yield* artifacts.capabilities(ref);
const diagnostics = yield* artifacts.view(ref, "diagnostics");
const graph = yield* artifacts.view(ref, "relationGraph");
```

The near-term goal is not universal media processing. The near-term goal is to
turn Schema IDE's existing source-file semantics into declared artifact
capabilities.

## MVP Slice

The first package should be a small `@schema-ide/artifacts` package inside this
monorepo. It is the proving ground for a future standalone `effect-artifacts`
package.

The MVP should include:

- artifact refs for workspace files, local paths, URLs, blobs, and git blobs
- pure artifact type declarations
- pure matchers for extension, MIME type, URI scheme, ref tag, and
  host-provided metadata
- view declarations with Effect Schema input/output/error contracts
- policy annotations for cost, cache, privacy, latency, determinism, output
  size, and media type
- handler binding by exact declared view identity
- a registry that can inspect capabilities for a ref
- a registry that can materialize a view through a handler
- input, output, and declared error validation around handler execution

The first Schema IDE integration should wrap existing capabilities rather than
create new parsers:

- `rawText` from a source file
- `parsedValue` for JSON/YAML documents
- `diagnostics` from existing validation
- `reflection` from existing reflection
- `jsonSchema` from current schema reflection
- `relationGraph` from schema-algebra where available

That is enough to prove that the artifact API can sit between model reasoning
and workspace execution.

## MVP Non-Goals

The MVP should explicitly defer:

- PDF parsing
- OCR
- video and audio processing
- browser rendering
- cloud SDK integrations
- remote document intelligence services
- streaming view representation
- cache storage implementation
- privacy enforcement implementation
- conversion planning such as `pdf -> images -> OCR -> markdown`
- handler ranking beyond exact view identity and registry order

The declarations may describe policy and cache semantics, but the first package
does not need to execute all of those policies.

## Package Integration Map

The package boundaries should stay close to the current repo:

```text
@schema-ide/artifacts
  -> declaration DSL, refs, matchers, handlers, registry

@schema-ide/core
  -> workspace-backed artifact refs and source-file views

@schema-ide/schema-algebra
  -> relationGraph/projection/diff/fingerprint views over decoded values

@schema-ide/agent
  -> capabilities/view tools for the model

@schema-ide/protocol
  -> optional HTTP/RPC exposure of artifact capabilities and views

@schema-ide/react
  -> UI affordances derived from capabilities
```

Start with `@schema-ide/artifacts` as an internal package. Extract or rename it
only once the API has survived use by Schema IDE core and agent tools.

## Workspace Deprecation Roadmap

The long-term direction is for Schema IDE to accept an `ArtifactProject` as its
primary input:

```tsx
<SchemaIde project={OnboardedProject} />
```

instead of:

```tsx
<SchemaIde schema={Workspace.Struct(...)} initialFiles={...} />
```

`Workspace.Struct` should become legacy compatibility sugar over artifacts, then
eventually be deprecated.

### Full Conversion Thesis

For a greenfield Schema IDE application, the core input should be a configured
artifact project, not a workspace schema.

That means the application starts from:

```ts
const project = ArtifactProject.make("onboarded")
  .files("accounts/*.yaml", {
    type: AccountArtifact,
    schema: AccountSchema,
  })
  .files("workflows/*.yaml", {
    type: WorkflowArtifact,
    schema: WorkflowSchema,
  })
  .algebra(OnboardedAlgebra);
```

and Schema IDE receives:

```tsx
<SchemaIde project={project} />
```

`Workspace.Struct` is then no longer the semantic root of the application. It is
an adapter for older callers that still want to describe file routes as a
workspace. The artifact project becomes the durable contract that the UI, CLI,
agent, protocol, tests, docs, and host integrations all share.

The expected replacement shape is:

```text
Workspace.Struct
  -> legacy route declaration API

ArtifactProject
  -> primary project declaration API

ArtifactStore
  -> source content, writes, history, and watch events

ArtifactRegistry
  -> capabilities and executable views

schema-algebra
  -> semantic graph over decoded artifact values
```

### Target Architecture

```text
ArtifactProject
  declares artifact routes, artifact types, views, schemas, policies, handlers

ArtifactStore
  owns refs, source content, writes, history, watch/events

ArtifactRegistry
  matches refs, exposes capabilities, materializes views

Schema Algebra
  derives semantic graph/views from parsed artifact values

Schema IDE
  renders, edits, validates, and agents over artifact capabilities
```

The core design rule:

```text
Artifacts own what exists and what views it exposes.
Schema Algebra owns what decoded values mean together.
Schema IDE owns how humans and agents inspect and edit the project.
```

This keeps the project from replacing `Workspace.Struct` with another
workspace-shaped abstraction. The primary unit is no longer "a set of files that
decode into one workspace value"; it is "a graph of artifact refs with declared,
typed, executable views."

### Project Configuration As Source Of Truth

The artifact project should become the serializable configuration boundary for
Schema IDE. For Onboarded and similar greenfield apps, the durable source of
truth can be YAML while TypeScript remains the executable declaration format.

```yaml
id: onboarded
files:
  - route: accounts/*.yaml
    artifact: Account
    format: yaml
  - route: workflows/*.yaml
    artifact: Workflow
    format: yaml
algebra:
  entities:
    - Account
    - Workflow
  relations:
    - from: Workflow.accountId
      to: Account.id
```

That configuration should round-trip into an executable project:

```ts
const OnboardedProject = ArtifactProject.fromYaml(onboardedConfig, {
  artifacts: {
    Account: AccountArtifact,
    Workflow: WorkflowArtifact,
  },
  algebra: OnboardedAlgebra,
});
```

The YAML file is the stable project declaration that a host, CLI, editor, or
agent can inspect. The TypeScript module provides the concrete schemas,
handlers, and algebra implementation needed to execute the declaration.

This suggests two related package-level APIs:

```ts
const config = OnboardedArtifactProject.toYaml(project);
const project = OnboardedArtifactProject.fromYaml(config, environment);
```

The YAML should be the single source of truth for serializable configuration:

- project id and display metadata
- file route patterns
- artifact names and formats
- declared project-level views
- schema-algebra relation declarations that can be serialized
- policy metadata that hosts can inspect before execution

The TypeScript side should provide non-serializable runtime values:

- Effect Schema values
- handler implementations
- service layers
- host-specific stores
- rich schema-algebra functions that cannot be represented as YAML

The split is intentional. YAML should not try to encode arbitrary TypeScript
programs, but TypeScript should not be the only place to discover project shape.

This avoids replacing `Workspace.Struct` with another non-serializable-only
shape. It also gives Onboarded a single configuration artifact that can drive:

- route registration
- validation
- relation graph construction
- agent tool affordances
- UI navigation
- docs and onboarding examples
- protocol snapshots

### How Workspace.Struct Gets Superseded

`Workspace.Struct` should not disappear abruptly. It should first become a
compatibility constructor for an artifact project.

```ts
const workspace = Workspace.Struct({
  accounts: Workspace.files("accounts/*.yaml", AccountSchema),
});

const project = ArtifactProject.fromWorkspace(workspace);
```

The replacement should be explicit:

```ts
const project = ArtifactProject.make("onboarded")
  .files("accounts/*.yaml", AccountArtifact)
  .files("workflows/*.yaml", WorkflowArtifact)
  .algebra(OnboardedAlgebra);
```

In the artifact-native model:

- `Workspace.Struct` becomes a legacy way to declare routes
- `Workspace.files` becomes artifact route sugar
- `Workspace.values` becomes a project-level decoded view
- workspace diagnostics become artifact views
- workspace snapshots become compatibility projections over artifact state

The public migration path should preserve old behavior while making the new
shape better for greenfield projects.

The deprecation should be implementation-led. Do not mark `Workspace.Struct`
legacy while first-party code still depends on it as the only way to describe a
project. The first milestone is to make every current workspace feature
representable as artifacts. The second milestone is to make Schema IDE execute
through artifacts internally. The third milestone is to leave `Workspace.Struct`
as pure compatibility sugar.

### Schema Algebra Boundary

Schema algebra should not be folded into artifacts. It should sit above decoded
artifact values and publish its own views.

Artifacts answer:

```text
what refs exist?
what type is this ref?
what views can this ref expose?
how do I parse, decode, validate, and reflect it?
```

Schema algebra answers:

```text
what entities exist across decoded artifacts?
what references connect them?
which references are broken?
where are definitions and usages?
what semantic patches are available?
```

That means an artifact project can expose schema-algebra results as views
without making the artifact package own relation semantics:

```ts
artifacts.view(ArtifactRef.workspace(), "relationGraph");
artifacts.view(ArtifactRef.workspaceFile("workflows/signup.yaml"), "references");
artifacts.view(ArtifactRef.workspace(), "referenceDiagnostics");
```

The dependency direction should remain:

```text
artifacts -> parse/decode/validate files
schema-algebra -> derive relations from decoded values
schema-ide -> render and edit both
```

In practice, this means schema-algebra should attach meaning to artifact views,
not to the old workspace container:

```text
artifact decoded values
  -> entity index
  -> relation graph
  -> reference diagnostics
  -> definition and usage locations
  -> patch suggestions
```

That lets the same algebra run over local files, remote blobs, generated
outputs, or future artifact stores as long as the declared views produce the
required decoded values.

### Cutover Criteria

`Workspace.Struct` can be deprecated only after these are true:

- `ArtifactProject.files` can express every current `Workspace.files` route
- artifact views cover source text, parsed value, decoded project, diagnostics,
  route matches, JSON Schema, reflection, and relation graph
- the React UI can accept an artifact project without constructing a workspace
  first
- agent tools can list artifacts, inspect capabilities, read views, and write
  source through artifact refs
- the protocol exposes artifact refs, capabilities, views, changes, and watch
  events
- Onboarded runs entirely through `OnboardedArtifactProject`
- compatibility helpers let existing `Workspace.Struct` examples keep working
- first-party packages no longer need to import `Workspace.Struct` directly

Only then should the docs mark `Workspace.Struct` as legacy.

### Migration Gates

Use these gates to keep the conversion honest:

1. **Declaration gate**: every current `Workspace.files` route can be expressed
   as `ArtifactProject.files`.
2. **Runtime gate**: artifact views can execute the same source text, parsed
   value, decoded value, diagnostics, JSON Schema, and reflection behavior as the
   current workspace runtime.
3. **Store gate**: reads, writes, creates, deletes, history, and watch events are
   modeled through `ArtifactStore`.
4. **UI gate**: React components can run from `<SchemaIde project={project} />`
   without constructing a workspace first.
5. **Agent gate**: agent tools operate on artifact refs and capabilities, with
   old workspace tools implemented as aliases.
6. **Protocol gate**: workspace RPC is either replaced by artifact RPC or backed
   by an artifact runtime internally.
7. **Example gate**: at least one small example and the Onboarded example are
   artifact-native.
8. **Docs gate**: public docs teach artifacts first and label workspaces as
   compatibility.

### Phase 1: Add Missing Artifact Primitives

Extend `@schema-ide/artifacts` with project-level concepts:

```ts
ArtifactProject.make("onboarded")
  .files("accounts/*.yaml", AccountArtifact)
  .files("workflows/*.yaml", WorkflowArtifact);
```

Add:

- `ArtifactRef.workspace(id?)`
- `ArtifactRef.workspaceFile(path, workspaceId?)`
- `ArtifactStore`
- `ArtifactProject`
- file route declarations
- project-level views like `diagnostics`, `reflection`, and `relationGraph`
- stable capability IDs

This is where artifacts start replacing `Workspace.Struct`, not just sitting
beside it.

### Phase 2: Recreate Workspace.Struct Semantics

Build artifact equivalents for current workspace features.

```ts
Workspace.files(pattern, schema)
```

becomes:

```ts
ArtifactProject.files(pattern, {
  type: ArtifactType.make("account"),
  schema: AccountSchema,
});
```

Current behavior to preserve:

- glob routing
- JSON/YAML decoding
- unmatched sidecar files
- route matches
- validation summaries
- reflected schemas
- active file JSON Schema
- diagnostics
- typed decoded workspace value

Add compatibility helpers:

```ts
ArtifactProject.fromWorkspace(workspace);
Workspace.fromArtifactProject(project);
```

This lets old and new APIs coexist while the repo migrates.

### Phase 3: Move Core Validation To Artifact Views

Today core validation is centered around:

```ts
validateSchemaIdeValue(...);
createReflection(...);
```

Artifact-native versions should be:

```ts
artifacts.view(ArtifactRef.workspace(), "diagnostics");
artifacts.view(ArtifactRef.workspace(), "reflection");
artifacts.view(ArtifactRef.workspaceFile("x.yaml"), "parsedValue");
artifacts.view(ArtifactRef.workspaceFile("x.yaml"), "jsonSchema");
```

The old functions can delegate internally to artifact views.

Important views:

- `sourceText`
- `parsedValue`
- `decodedWorkspace`
- `diagnostics`
- `validationSummary`
- `routeMatches`
- `jsonSchema`
- `reflection`

### Phase 4: Make Schema Algebra Artifact-Native

Schema Algebra should consume parsed artifact values, not raw workspace structs.

Move this:

```ts
Workspace.indexBy("id");
Workspace.validate(...);
```

toward this:

```ts
Relation.id("Account");
Relation.ref("Workflow");
```

and expose artifact views:

- `relationGraph`
- `entityIndex`
- `definitionLocations`
- `references`
- `referenceDiagnostics`
- `patchSuggestions`

Cross-file meaning should become schema-algebra derived, not
workspace-specific logic.

Status: started. Core artifact runtimes now expose graph-derived schema-algebra
views for `entityIndex`, `definitionLocations`, `references`, and
`referenceDiagnostics` in addition to `patchSuggestions` and the existing
`relationGraph` and `relationDiagnostics` views. These views are available on
project refs and schema-backed file refs, giving agents and UIs a richer
artifact-native inspection surface without reaching through `Workspace.Struct`
directly.
`@schema-ide/schema-algebra` owns the graph-derived helper functions, keeping
core responsible for view exposure rather than relation semantics.

### Phase 5: Convert Onboarded First

Onboarded should be the first full conversion because it is domain-specific and
schema-heavy.

```ts
const OnboardedProject = ArtifactProject.make("onboarded")
  .files("accounts/*.yaml", AccountArtifact)
  .files("workflows/*.yaml", WorkflowArtifact)
  .algebra(OnboardedAlgebra);
```

Then update:

- Onboarded README examples
- CLI validation path
- bundled sample workspace
- playground template
- tests and evals using `Workspace.Struct`

Onboarded becomes the proof that artifacts can fully replace workspaces.

Status: partially implemented. `OnboardedArtifactProject` and its serializable
YAML config are now the route source of truth for the packaged Onboarded sample.
`OnboardedAccountWorkspaceSchema` is derived from that artifact project through
the compatibility projection, and the existing cross-file validations remain
attached while schema-algebra relation views continue to be exposed as artifact
views. Onboarded artifact runtimes now derive relation views from a structural
artifact-project decode, so relation diagnostics and patch suggestions remain
available even when compatibility workspace validation reports cross-file
errors. The remaining work is to remove UI/CLI naming that still says
"workspace" and to finish moving bespoke Onboarded validation behavior into
artifact-native schema-algebra views.

CLI configuration naming has started moving in this direction:
`defineSchemaIdeProject` now accepts an artifact project as the primary config
shape, derives the compatibility workspace schema when omitted, and is used by
the first-party artifact-backed example and Onboarded configs.

### Phase 6: Update React SchemaIde API

Add artifact-first props:

```tsx
<SchemaIde project={project} />
```

Keep old props temporarily:

```tsx
<SchemaIde schema={schema} initialFiles={files} />
```

but implement them as sugar:

```ts
const project = ArtifactProject.fromSchemaIdeInput({ schema, files });
```

The UI should switch to artifact concepts internally:

- file tree lists refs from `ArtifactStore`
- editor reads `sourceText`
- diagnostics panel reads `diagnostics`
- schema/form view reads `jsonSchema`
- reflection panel reads `reflection`
- future affordances come from capabilities

Status: started. React now accepts artifact project declarations through
`<SchemaIde project={project} />` without requiring callers to also pass a
workspace schema. The compatibility schema is derived internally from
`ArtifactProject` routes when omitted, and project-only clients initialize from
the provided artifact files instead of inventing a synthetic document. The UI is
still backed by the workspace service/view model internally, so the remaining
work is to move file listing, editor reads, diagnostics, and preview state onto
artifact refs and views directly.

### Phase 7: Update Agent Tools

Add artifact-native tools:

```text
list_artifacts
get_artifact_capabilities
read_artifact_view
write_artifact_source
validate_artifact_project
```

Then gradually rewrite old tools:

```text
read_file              -> read_artifact_view(sourceText)
get_diagnostics        -> read_artifact_view(diagnostics)
get_json_schema        -> read_artifact_view(jsonSchema)
validate_workspace     -> validate_artifact_project
```

Keep old tool names as aliases until prompts and evals are migrated.

Status: implemented in `@schema-ide/agent`. The artifact-native tools are
available, and the legacy file/list/search/source write/validation/schema tools
now route through artifact refs, artifact views, and `sourceText` writes when
the host runtime provides artifact operations. `apply_edits` and `propose_patch`
remain workspace workflow tools until the artifact model grows an explicit patch
transaction primitive.

### Phase 8: Protocol Migration

Add artifact endpoints or RPC methods:

```text
GetArtifactCapabilities
ReadArtifactView
ListArtifactRefs
ApplyArtifactChange
WatchArtifactProject
```

Status: mostly implemented as compatibility-backed workspace RPC. The shared
protocol, server handlers, React RPC client, CLI local client, and workspace
store already expose artifact refs, capability inspection, view reads, and
`writeSource` changes. The protocol also exposes `WatchArtifactProject` as an
artifact-named alias over the existing snapshot-compatible watch events, and
the React store subscribes through that artifact-named stream. This leaves room
for a distinct artifact event shape later without blocking artifact-first
clients today.

Keep existing workspace RPC temporarily, but have it delegate to the artifact
project runtime.

Eventually `WorkspaceSnapshot` becomes either `ArtifactProjectSnapshot` or a
compatibility projection from artifact state.

### Phase 9: Deprecate Workspace.Struct

Once Onboarded, examples, React, agent, and protocol all use artifacts
internally:

1. mark `Workspace.Struct` as deprecated in docs and JSDoc
2. keep compatibility adapters for one release cycle
3. remove direct use from first-party packages
4. move workspace-specific helpers into a legacy module
5. eventually delete or freeze the workspace DSL

Status: started. `@schema-ide/core` now exposes
`createWorkspaceFromArtifactProject` so artifact route declarations can produce
temporary `WorkspaceSchema` projections for compatibility. The workflow example
uses this path, making `WorkflowArtifactProject` the route source of truth while
existing preview, CLI, and validation paths continue to consume
`WorkflowWorkspaceSchema`. The survey and prompt-eval examples now follow the
same route-source pattern through `SurveyArtifactProject` and
`PromptEvalArtifactProject`, with their CLI configs exporting artifact projects
and their workspace schemas derived as compatibility projections. Onboarded now
uses the same route-source-of-truth path:
`OnboardedAccountWorkspaceSchema` is projected from
`OnboardedArtifactProject`, while runtime helpers live outside the pure artifact
declarations to avoid an artifact/workspace import cycle.
`@schema-ide/cli` now also exposes `defineSchemaIdeProject`, letting
artifact-native configs export `{ project }` first while older
`defineSchemaIdeWorkspace` configs remain supported.

### Recommended Order Of Work

1. extend `@schema-ide/artifacts` with `ArtifactProject` and `ArtifactStore`
2. implement `ArtifactProject.files(pattern, schema)` as the replacement for
   `Workspace.files`
3. add core artifact views for source text, parsed value, diagnostics,
   reflection, and JSON Schema
4. convert one small example package
5. convert Onboarded
6. update `<SchemaIde project={...} />`
7. add artifact-native agent tools
8. move schema-algebra relation/index behavior into artifact views
9. deprecate `Workspace.Struct`

## What Should Stay Out Of The Core

The core package should stay small.

It should not ship PDF parsing, OCR, ffmpeg, transcription, browser rendering, or cloud SDKs.

The core package should define:

- artifact declarations
- view declarations
- schema contracts
- handler binding
- registry inspection
- matching primitives
- policy annotations
- helper services

Heavy implementations should live in optional packages:

- `effect-artifacts-node`
- `effect-artifacts-pdf`
- `effect-artifacts-video`
- `effect-artifacts-image`
- `effect-artifacts-json`

The core should be useful even if every handler is provided by a host application.

## Design Pressure

The DSL should describe capabilities, not workflows.

It is tempting to make the registry plan conversions:

```text
pdf -> page images -> OCR text -> markdown -> summary
```

That may become useful later, but it should not be the first primitive. The first primitive should be simpler:

```text
artifact type declares views
view declares schemas and policy
handler implements the view
harness chooses and invokes views
```

The planning layer can be built on top once the capability graph exists.

## Open Questions

- Should `ArtifactApi` live as a standalone `effect-artifacts` package or under a future `@effect/ai` namespace?
- Should matchers be pure declarations, effectful probes, or both?
- How should streaming views be represented: `Stream`, chunked outputs, or separate view kinds?
- Should views be globally named strings like `"markdown"` or nominal values exported from modules?
- How much of `HttpApi`'s internal design can this mirror without coupling to HTTP-specific assumptions?
- Should handlers be resolved by exact view identity, by type/view string pair, or by an opaque endpoint value?
- What is the minimal registry API that lets an agent inspect capabilities without exposing implementation details?

## North Star

`effect-artifacts` should make files and generated outputs feel like typed Effect APIs.

A workspace should not be a bag of bytes plus ad hoc tools. It should be a runtime-inspectable graph of artifacts, views, schemas, policies, and handlers.

The same declaration should be useful to:

- TypeScript type inference
- runtime validation
- tool generation
- agent planning
- docs
- caching
- UI affordances
- host policy

That is the real shape of the idea: artifact declarations as executable, inspectable schema modules.
