# @schematics/ide

React UI surface for editing a Schematics artifact project.
It renders the file list, CodeMirror editor, schema-derived form view, patch proposal panel, diagnostics/debug panels, and chat panel.
The component accepts an artifact project, a raw Effect Schema, or a
`WorkspaceSchema` from the core package.
Bring your own chat adapter, including the local debug adapter or HTTP agent adapter.
This package is the extraction target for `@schematics/ide`.

Artifact-first projects can use `<Schematics project={...}>`. When every route
declares a schema, React can read source text, decoded values, diagnostics, JSON
Schemas, and reflection from the artifact project runtime without using the
deprecated `Workspace.Struct` compatibility API:

```tsx
import { Schema } from "effect";
import { ArtifactProject } from "@schematics/artifacts";
import { SchematicsProjectFileArtifact } from "@schematics/core";
import { Schematics } from "@schematics/ide";

const SettingsSchema = Schema.Struct({
  id: Schema.String,
  enabled: Schema.Boolean,
});

const Project = ArtifactProject.make("settings").files("settings/*.yaml", {
  id: "settings",
  type: SchematicsProjectFileArtifact,
  schema: SettingsSchema,
});

<Schematics
  project={Project}
  initialFiles={[{ path: "settings/app.yaml", content: "id: app\nenabled: true\n" }]}
  defaultFormat="yaml"
/>;
```

```tsx
import { Schematics } from "@schematics/ide";
import { createSchematicsChatAdapter } from "@schematics/agent";
import { WorkflowArtifactProject } from "@schematics/examples";

<Schematics
  project={WorkflowArtifactProject}
  initialFiles={[]}
  defaultFormat="json"
  chat={createSchematicsChatAdapter({ baseUrl: "/v1" })}
/>;
```

```tsx
import { Schema } from "effect";
import { Schematics } from "@schematics/ide";

// Raw schemas remain available for single-document compatibility surfaces.
const SettingsSchema = Schema.Struct({
  id: Schema.String,
  enabled: Schema.Boolean,
});

<Schematics schema={SettingsSchema} value={settings} onChange={setSettings} defaultFormat="yaml" />;
```
