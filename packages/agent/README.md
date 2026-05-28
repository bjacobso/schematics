# @schema-ide/agent

Agent-facing chat adapters and schema-driven workspace tools for Schema IDE.
Use this package to let a model list, read, grep, create, write, replace, atomically apply, propose, and validate files.
Tool definitions are derived from Effect Schema and exported in OpenRouter-compatible shape.
The HTTP adapter talks to the standalone `/v1/chat` API from the protocol package.
This package is the extraction target for `@schema-ide/agent`.
Set `planMode` on a chat turn to expose read-only tools plus `propose_patch`, leaving final application to the user.

The package also exposes artifact-native tools as the migration path away from
workspace-only operations:

- `list_artifacts`
- `get_artifact_capabilities`
- `read_artifact_view`
- `write_artifact_source`
- `validate_artifact_project`

These currently adapt the existing Schema IDE workspace service into workspace
and workspace-file artifact refs.

```ts
import { createSchemaIdeChatAdapter } from "@schema-ide/agent";

const chat = createSchemaIdeChatAdapter({
  baseUrl: "/v1",
  defaultModel: "~anthropic/claude-sonnet-latest",
});
```
