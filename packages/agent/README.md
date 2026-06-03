# @schematics/agent

Agent-facing chat adapters and artifact-aware tools for Schematics.
Use this package to let a model list artifact refs, inspect capabilities, read and write declared views, and use compatibility file tools while projects migrate.
Tool definitions are derived from Effect Schema and exported in OpenRouter-compatible shape.
The HTTP adapter talks to the standalone `/v1/chat` API from the protocol package.
This package is the extraction target for `@schematics/agent`.
Set `planMode` on a chat turn to expose read-only tools plus `propose_patch`, leaving final application to the user.

The artifact-native tools are the primary model-facing surface:

- `list_artifacts`
- `get_artifact_capabilities`
- `read_artifact_view`
- `write_artifact_source`
- `validate_artifact_project`

Compatibility workspace/file tools remain available as aliases over workspace
and workspace-file artifact refs.

```ts
import { createSchematicsChatAdapter } from "@schematics/agent";

const chat = createSchematicsChatAdapter({
  baseUrl: "/v1",
  defaultModel: "~anthropic/claude-sonnet-latest",
});
```
