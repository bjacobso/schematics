# @schema-ide/core

Core schema, filesystem, codec, validation, and reflection primitives for Schema IDE.
Use this package when you want to describe a workspace of JSON/YAML files with Effect Schema.
It has no React, agent, or server dependency.
Runtime dependencies are `effect` and `yaml`.
This package is the extraction target for `@schema-ide/core`.

```ts
import { Schema } from "effect";
import { Workspace, validateSchemaIdeValue } from "@schema-ide/core";

const Prompt = Schema.Struct({
  id: Schema.String,
  template: Schema.String,
});

const PromptWorkspace = Workspace.Struct({
  prompts: Workspace.files("prompts/*.yaml", Prompt),
});

const validation = validateSchemaIdeValue({
  schema: PromptWorkspace,
  files: [{ path: "prompts/support.yaml", content: "id: support\ntemplate: Hi\n" }],
  activeFile: "prompts/support.yaml",
  activeFormat: "yaml",
});
```

Versioned workspaces record committed file changes as revisions. Manual editor
drafts can stay outside history until saved, while agent tool calls can commit
one revision per tool call with turn metadata.

```ts
import {
  applyWorkspaceChange,
  createVersionedWorkspace,
  undoWorkspaceChange,
} from "@schema-ide/core";

const workspace = createVersionedWorkspace([
  { path: "prompts/support.yaml", content: "id: support\ntemplate: Hi\n" },
]);

const edited = applyWorkspaceChange(
  workspace,
  {
    type: "writeFile",
    path: "prompts/support.yaml",
    content: "id: support\ntemplate: Hello\n",
  },
  {
    actor: "agent",
    label: "write_file prompts/support.yaml",
    turnId: "turn-1",
    toolCallId: "call-1",
  },
);

const previous = undoWorkspaceChange(edited);
```

Workspace validation and reflection can also be exposed through artifact views
as the migration path away from `Workspace.Struct`:

```ts
import { Effect } from "effect";
import { ArtifactRef } from "@schema-ide/artifacts";
import { createSchemaIdeArtifactRuntime } from "@schema-ide/core";

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
