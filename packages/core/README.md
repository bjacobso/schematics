# @schema-ide/core

Core artifact runtime, filesystem, codec, validation, and reflection primitives for Schema IDE.
Use this package when you want to describe JSON/YAML files as a typed artifact project with Effect Schema.
It has no React, agent, or server dependency.
Runtime dependencies are `effect` and `yaml`.
This package is the extraction target for `@schema-ide/core`.

```ts
import { Effect, Schema } from "effect";
import { ArtifactProject, ArtifactRef } from "@schema-ide/artifacts";
import {
  SchemaIdeWorkspaceFileArtifact,
  createSchemaIdeArtifactRuntime,
  createWorkspaceFromArtifactProject,
} from "@schema-ide/core";

const Prompt = Schema.Struct({
  id: Schema.String,
  template: Schema.String,
});

const PromptProject = ArtifactProject.make("prompts").files("prompts/*.yaml", {
  id: "Prompts",
  type: SchemaIdeWorkspaceFileArtifact,
  schema: Prompt,
});
const PromptWorkspace = createWorkspaceFromArtifactProject(PromptProject);

const artifacts = createSchemaIdeArtifactRuntime({
  project: PromptProject,
  schema: PromptWorkspace,
  files: [{ path: "prompts/support.yaml", content: "id: support\ntemplate: Hi\n" }],
  activeFile: "prompts/support.yaml",
  activeFormat: "yaml",
});

const diagnostics = await Effect.runPromise(artifacts.view(ArtifactRef.workspace(), "diagnostics"));
```

`Workspace.Struct` remains available as a compatibility declaration API while
first-party code migrates to artifact projects:

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

const diagnostics = await Effect.runPromise(artifacts.view(ArtifactRef.workspace(), "diagnostics"));
const sourceText = await Effect.runPromise(
  artifacts.view(ArtifactRef.workspaceFile("prompts/support.yaml"), "sourceText"),
);
```

Versioned workspaces record committed file changes as revisions. Manual editor
drafts can stay outside history until saved, while agent tool calls can commit
one revision per tool call with turn metadata.
