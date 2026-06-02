# @schema-ide/core

Core artifact runtime, filesystem, codec, validation, and reflection primitives for Schema IDE.
Use this package when you want to describe JSON/YAML files as a typed artifact project with Effect Schema.
It has no React, agent, or server dependency.
Runtime dependencies are `effect` and `yaml`.
This package is the extraction target for `@schema-ide/core`.

```ts
import { Effect, Schema } from "effect";
import { ArtifactRef } from "@schema-ide/artifacts";
import {
  ArtifactProject,
  SchemaIdeProjectFileArtifact,
  createSchemaIdeArtifactRuntime,
} from "@schema-ide/core";

const Prompt = Schema.Struct({
  id: Schema.String,
  template: Schema.String,
});

const PromptProject = ArtifactProject.make("prompts").files("prompts/*.yaml", {
  id: "Prompts",
  type: SchemaIdeProjectFileArtifact,
  schema: Prompt,
  metadata: {
    attributes: {
      workspaceField: "prompts",
      values: true,
      format: "yaml",
    },
  },
});

const artifacts = createSchemaIdeArtifactRuntime({
  project: PromptProject,
  files: [{ path: "prompts/support.yaml", content: "id: support\ntemplate: Hi\n" }],
  activeFile: "prompts/support.yaml",
  activeFormat: "yaml",
});

const diagnostics = await Effect.runPromise(artifacts.view(ArtifactRef.project(), "diagnostics"));
```

`Workspace.Struct` remains available as a deprecated compatibility declaration
API for older callers:

```ts
import { Effect } from "effect";
import { ArtifactRef } from "@schema-ide/artifacts";
import { Workspace, createSchemaIdeArtifactRuntime } from "@schema-ide/core";

const PromptWorkspace = Workspace.Struct({
  prompts: Workspace.files("prompts/*.yaml", Prompt),
});

const artifacts = createSchemaIdeArtifactRuntime({
  schema: PromptWorkspace,
  files: [{ path: "prompts/support.yaml", content: "id: support\ntemplate: Hi\n" }],
  activeFile: "prompts/support.yaml",
  activeFormat: "yaml",
});

const diagnostics = await Effect.runPromise(artifacts.view(ArtifactRef.project(), "diagnostics"));
const sourceText = await Effect.runPromise(
  artifacts.view(ArtifactRef.projectFile("prompts/support.yaml"), "sourceText"),
);
```

Artifact projects with schema-backed routes can also drive the runtime directly:

```ts
const artifacts = createSchemaIdeArtifactRuntime({
  project: PromptProject,
  files: [{ path: "prompts/support.yaml", content: "id: support\ntemplate: Hi\n" }],
  activeFile: "prompts/support.yaml",
  activeFormat: "yaml",
});
```

Pass `relationSchema` when the project-decoded workspace value should also
expose schema-algebra views such as `relationGraph`, `referenceDiagnostics`, and
`patchSuggestions`.

Compatibility projects can be projected in either direction from the core
facade:

```ts
const project = ArtifactProject.fromWorkspace(PromptWorkspace);
const workspace = Workspace.fromArtifactProject(project);
```

Legacy versioned workspaces record committed file changes as revisions. Manual editor
drafts can stay outside history until saved, while agent tool calls can commit
one revision per tool call with turn metadata.
