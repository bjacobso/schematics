# @schema-ide/react

React UI surface for editing a Schema IDE artifact project.
It renders the file list, CodeMirror editor, schema-derived form view, patch proposal panel, diagnostics/debug panels, and chat panel.
The component accepts an artifact project, a raw Effect Schema, or a
`WorkspaceSchema` from the core package.
Bring your own chat adapter, including the local debug adapter or HTTP agent adapter.
This package is the extraction target for `@schema-ide/react`.

Artifact-first projects can use `<SchemaIde project={...}>`. When every route
declares a schema, React can read source text, decoded values, diagnostics, JSON
Schemas, and reflection from the artifact project runtime without using the
deprecated `Workspace.Struct` compatibility API:

```tsx
import { Schema } from "effect";
import { ArtifactProject } from "@schema-ide/artifacts";
import { SchemaIdeProjectFileArtifact } from "@schema-ide/core";
import { SchemaIde } from "@schema-ide/react";

const SettingsSchema = Schema.Struct({
  id: Schema.String,
  enabled: Schema.Boolean,
});

const Project = ArtifactProject.make("settings").files("settings/*.yaml", {
  id: "settings",
  type: SchemaIdeProjectFileArtifact,
  schema: SettingsSchema,
});

<SchemaIde
  project={Project}
  initialFiles={[{ path: "settings/app.yaml", content: "id: app\nenabled: true\n" }]}
  defaultFormat="yaml"
/>;
```

```tsx
import { SchemaIde } from "@schema-ide/react";
import { createSchemaIdeChatAdapter } from "@schema-ide/agent";
import { WorkflowArtifactProject } from "@schema-ide/examples";

<SchemaIde
  project={WorkflowArtifactProject}
  initialFiles={[]}
  defaultFormat="json"
  chat={createSchemaIdeChatAdapter({ baseUrl: "/v1" })}
/>;
```

```tsx
import { Schema } from "effect";
import { SchemaIde } from "@schema-ide/react";

// Raw schemas remain available for single-document compatibility surfaces.
const SettingsSchema = Schema.Struct({
  id: Schema.String,
  enabled: Schema.Boolean,
});

<SchemaIde schema={SettingsSchema} value={settings} onChange={setSettings} defaultFormat="yaml" />;
```
