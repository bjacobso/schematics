# @schema-ide/cli

Local command-line validation for Schema IDE artifact projects.

Use this package when you want the same artifact routing, schema validation,
and diagnostics used by the React IDE and agent tools, but against files on
disk.

## Config

Create a config module that exports an artifact project definition:

```ts
import { Schema } from "effect";
import { ArtifactProject } from "@schema-ide/artifacts";
import { SchemaIdeWorkspaceFileArtifact } from "@schema-ide/core";
import { defineSchemaIdeProject } from "@schema-ide/cli";

const Action = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
});

const Workflow = Schema.Struct({
  id: Schema.String,
  actionIds: Schema.Array(Schema.String),
});

const WorkflowProject = ArtifactProject.make("workflow")
  .files("actions/*.json", {
    id: "Actions",
    type: SchemaIdeWorkspaceFileArtifact,
    schema: Action,
    metadata: { attributes: { workspaceField: "actions", indexBy: "id" } },
  })
  .files("workflows/*.json", {
    id: "Workflows",
    type: SchemaIdeWorkspaceFileArtifact,
    schema: Workflow,
    metadata: { attributes: { workspaceField: "workflows", indexBy: "id" } },
  });

export default defineSchemaIdeProject({
  id: "workflow",
  project: WorkflowProject,
  defaultFormat: "json",
});
```

`defineSchemaIdeWorkspace` and `Workspace.Struct` remain available for legacy
configs, but first-party examples now export `defineSchemaIdeProject` and let
the CLI derive the temporary compatibility workspace projection.

## Commands

Validate a directory:

```bash
schema-ide validate --schema ./schema-ide.config.ts --dir .
```

Print machine-readable diagnostics for local agents:

```bash
schema-ide validate --schema ./schema-ide.config.ts --dir . --json
```

Inspect route matches:

```bash
schema-ide routes --schema ./schema-ide.config.ts --dir .
```

Print reflected JSON Schema for a route:

```bash
schema-ide schema --schema ./schema-ide.config.ts --dir . --schema-id Workflows
```

The `validate` and `inspect` commands exit with code `1` when validation has
errors. Usage and CLI errors exit with code `2`.

By default, the CLI reads `**/*.json`, `**/*.yaml`, and `**/*.yml`, excluding
`.git/**`, `node_modules/**`, `dist/**`, and `coverage/**`. Override that in the
config with `include` and `exclude`.

## Ship your own CLI

Consumers can also embed an artifact project and publish a domain-specific
binary. Their users do not need to pass `--schema`; they run the same validation
runtime with the project already wired in. Use `createEmbeddedSchemaIdeCli` when
the binary should only speak the bundled project, such as a Node SEA build.

```ts
#!/usr/bin/env node
import { createEmbeddedSchemaIdeCli, defineSchemaIdeProject } from "@schema-ide/cli";
import { WorkflowArtifactProject } from "./schema";

const workspace = defineSchemaIdeProject({
  id: "workflow",
  project: WorkflowArtifactProject,
  defaultFormat: "yaml",
  include: ["**/*.yaml", "**/*.yml"],
});

await createEmbeddedSchemaIdeCli({
  name: "workflow",
  workspace,
}).main();
```

That binary can expose commands such as:

```bash
workflow validate --dir .
workflow validate --dir . --json
workflow routes --dir .
```

Use `createSchemaIdeCli` instead when the wrapper CLI should still accept
`--schema` overrides, or pass `schemaPath` when it should load a bundled config
module at runtime. The public `run` method is useful for tests or custom process
handling:

```ts
const cli = createSchemaIdeCli({ name: "workflow", workspace });
const result = await cli.run(["validate", "--dir", ".", "--json"]);
```
