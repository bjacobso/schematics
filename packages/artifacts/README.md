# @schema-ide/artifacts

Effect-native artifact declarations for Schema IDE.

This package is the MVP proving ground for the broader `effect-artifacts` idea:
declare artifact types, match refs, expose typed views, bind handlers, inspect
capabilities, and materialize views through Effect programs.

It intentionally does not ship parsers for PDFs, images, video, OCR, or cloud
storage. Hosts provide handlers.

```ts
import { Effect, Schema } from "effect";
import {
  ArtifactApi,
  ArtifactHandler,
  ArtifactMatcher,
  ArtifactProject,
  ArtifactRef,
  ArtifactRegistry,
  ArtifactType,
  CachePolicy,
  Cost,
} from "@schema-ide/artifacts";

const Json = ArtifactType.make("json")
  .match(ArtifactMatcher.extension("json"))
  .view("parsedValue", {
    input: Schema.Struct({ content: Schema.String }),
    output: Schema.Unknown,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  });

const Artifacts = ArtifactApi.make("workspace").add(Json);

const registry = ArtifactRegistry.make(Artifacts).addHandler(
  ArtifactHandler.make(Json.view("parsedValue"), ({ input }) =>
    Effect.try({
      try: () => JSON.parse(input.content) as unknown,
      catch: (error) => error,
    }),
  ),
);

const caps = await Effect.runPromise(registry.capabilities(ArtifactRef.path("config.json")));
```

Projects add file routing and project-level views on top of artifact APIs:

```ts
const Project = ArtifactProject.make("demo")
  .files("config/*.json", Json, { id: "configs" })
  .view("diagnostics", {
    output: Schema.Array(Schema.String),
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
    },
  });

const fileCaps = Project.capabilities(ArtifactRef.projectFile("config/app.json"));
const workspaceCaps = Project.capabilities(ArtifactRef.project());
```

Serializable project configs can become executable projects when a host supplies
the non-serializable schemas and artifact types:

```ts
const config = ArtifactProject.toConfig(Project);
const decodedConfig = Schema.decodeUnknownSync(ArtifactProjectConfigSchema)(config);
const ProjectFromConfig = ArtifactProject.fromConfig(decodedConfig, {
  artifacts: {
    json: Json,
  },
});
```

`ArtifactProjectConfigSchema` and `ArtifactProjectFileConfigSchema` are exported
for hosts that decode project configs from YAML, JSON, or another document
format before binding them to runtime schemas and handlers.

Route configs can also carry compatibility projection hints such as
`workspaceField`, `mode`, and `indexBy`. Schema IDE core uses those hints when
it derives a temporary `Workspace` projection from an artifact project.

## Status

Implemented:

- artifact refs for paths, URLs, blobs, git blobs, workspaces, and workspace files
- artifact stores with an in-memory implementation for workspace files
- artifact projects with file routes, project-level workspace views, and
  serializable project config round-trips
- Effect Schema contracts for serializable artifact project configs
- pure matchers for extension, MIME type, URI scheme, ref tag, and metadata
- artifact type and view declarations
- view policy annotations
- handler binding by exact view declaration identity
- registry capability inspection
- registry view materialization
- Effect Schema validation for handler input, output, and declared errors

Deferred:

- cache storage
- privacy enforcement
- streaming view kinds
- handler ranking beyond registry order
- conversion planning
