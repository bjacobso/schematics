import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import { formatForPath, parseDocument } from "@schema-ide/core";
import { ToolFailure, ValidationSummary } from "./common-toolkit-schemas";
import { MutationResult } from "./workspace-schemas";
import { SchemaIdeWorkspace, toolFailure } from "./schema-ide-workspace";

const ArtifactRefSchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Workspace"),
    workspaceId: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    _tag: Schema.Literal("WorkspaceFile"),
    path: Schema.String,
    workspaceId: Schema.optional(Schema.String),
  }),
]);

type ArtifactRefInput = typeof ArtifactRefSchema.Type;

const ArtifactCapabilitySchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  view: Schema.String,
  routeId: Schema.optional(Schema.String),
  routePattern: Schema.optional(Schema.String),
  annotations: Schema.Unknown,
});

export const ListArtifactsTool = Tool.make("list_artifacts", {
  description: "List artifact refs available in the Schema IDE project.",
  success: Schema.Struct({
    artifacts: Schema.Array(ArtifactRefSchema),
    count: Schema.Number,
  }),
  failure: ToolFailure,
  failureMode: "return",
});

export const GetArtifactCapabilitiesTool = Tool.make("get_artifact_capabilities", {
  description:
    "Return the declared artifact views available for a workspace or workspace file ref.",
  parameters: Schema.Struct({
    ref: ArtifactRefSchema,
  }),
  success: Schema.Struct({
    capabilities: Schema.Array(ArtifactCapabilitySchema),
  }),
  failure: ToolFailure,
  failureMode: "return",
});

export const ReadArtifactViewTool = Tool.make("read_artifact_view", {
  description:
    "Read a typed artifact view. Use sourceText for files and diagnostics, validationSummary, routeMatches, reflection, or decodedWorkspace for the project.",
  parameters: Schema.Struct({
    ref: ArtifactRefSchema,
    view: Schema.String,
  }),
  success: Schema.Struct({
    ref: ArtifactRefSchema,
    view: Schema.String,
    value: Schema.Unknown,
  }),
  failure: ToolFailure,
  failureMode: "return",
});

export const WriteArtifactSourceTool = Tool.make("write_artifact_source", {
  description: "Replace the sourceText view of a workspace file artifact.",
  parameters: Schema.Struct({
    ref: Schema.Struct({
      _tag: Schema.Literal("WorkspaceFile"),
      path: Schema.String,
      workspaceId: Schema.optional(Schema.String),
    }),
    content: Schema.String,
  }),
  success: MutationResult,
  failure: ToolFailure,
  failureMode: "return",
});

export const ValidateArtifactProjectTool = Tool.make("validate_artifact_project", {
  description: "Validate the current artifact project and return diagnostics and route matches.",
  success: Schema.Struct({
    summary: ValidationSummary,
    diagnostics: Schema.Array(Schema.Unknown),
    routeMatches: Schema.Array(Schema.Unknown),
  }),
  failure: ToolFailure,
  failureMode: "return",
});

export const ArtifactToolkit = Toolkit.make(
  ListArtifactsTool,
  GetArtifactCapabilitiesTool,
  ReadArtifactViewTool,
  WriteArtifactSourceTool,
  ValidateArtifactProjectTool,
);

export const ArtifactToolkitLayer = ArtifactToolkit.toLayer(
  Effect.gen(function* () {
    const workspace = yield* SchemaIdeWorkspace;
    return ArtifactToolkit.of({
      list_artifacts: Effect.fn("ArtifactToolkit.list_artifacts")(function* () {
        const files = yield* workspace.listFiles;
        const artifacts = [
          { _tag: "Workspace" as const },
          ...files.map((path) => ({ _tag: "WorkspaceFile" as const, path })),
        ];
        return { artifacts, count: artifacts.length };
      }),
      get_artifact_capabilities: Effect.fn("ArtifactToolkit.get_artifact_capabilities")(function* ({
        ref,
      }) {
        return { capabilities: yield* capabilitiesForRef(ref) };
      }),
      read_artifact_view: Effect.fn("ArtifactToolkit.read_artifact_view")(function* ({
        ref,
        view,
      }) {
        return { ref, view, value: yield* readView(ref, view) };
      }),
      write_artifact_source: Effect.fn("ArtifactToolkit.write_artifact_source")(function* ({
        ref,
        content,
      }) {
        yield* workspace.writeFile({ path: ref.path, content });
        const reflection = yield* workspace.validateWorkspace;
        return { success: true, path: ref.path, validation: reflection.validationSummary };
      }),
      validate_artifact_project: Effect.fn("ArtifactToolkit.validate_artifact_project")(
        function* () {
          const reflection = yield* workspace.validateWorkspace;
          return {
            summary: reflection.validationSummary,
            diagnostics: Array.from(reflection.diagnostics),
            routeMatches: Array.from(reflection.routeMatches),
          };
        },
      ),
    });

    function capabilitiesForRef(ref: ArtifactRefInput) {
      return Effect.gen(function* () {
        if (ref._tag === "Workspace") {
          return workspaceCapabilities();
        }

        const reflection = yield* workspace.validateWorkspace;
        const route = reflection.routeMatches.find((candidate) => candidate.path === ref.path);
        const routeId = route?.schemaId ?? undefined;
        const routePattern = routeId
          ? reflection.schemas.find((schema) => schema.id === routeId)?.match
          : undefined;
        return fileCapabilities(routeId, routePattern);
      });
    }

    function readView(ref: ArtifactRefInput, view: string) {
      return ref._tag === "Workspace"
        ? readWorkspaceView(view)
        : readWorkspaceFileView(ref.path, view);
    }

    function readWorkspaceView(view: string) {
      return Effect.gen(function* () {
        const reflection = yield* workspace.validateWorkspace;
        switch (view) {
          case "decodedWorkspace":
            return reflection.decodedValue;
          case "diagnostics":
            return Array.from(reflection.diagnostics);
          case "validationSummary":
            return reflection.validationSummary;
          case "routeMatches":
            return Array.from(reflection.routeMatches);
          case "reflection":
            return reflection;
          default:
            return yield* Effect.fail(toolFailure(`Unknown workspace artifact view: ${view}`));
        }
      });
    }

    function readWorkspaceFileView(path: string, view: string) {
      return Effect.gen(function* () {
        const file = yield* workspace.readFile(path);
        switch (view) {
          case "sourceText":
            return file.content;
          case "parsedValue": {
            const parsed = parseDocument(file.content, formatForPath(path), path);
            if (!parsed.success) return yield* Effect.fail(toolFailure(parsed.diagnostic.message));
            return parsed.value;
          }
          case "jsonSchema": {
            const reflection = yield* workspace.validateWorkspace;
            const route = reflection.routeMatches.find((candidate) => candidate.path === path);
            if (!route?.schemaId) return null;
            return (
              reflection.schemas.find((schema) => schema.id === route.schemaId)?.jsonSchema ?? null
            );
          }
          case "diagnostics": {
            const reflection = yield* workspace.validateWorkspace;
            return reflection.diagnostics.filter(
              (diagnostic) => diagnostic.path === path || diagnostic.path === null,
            );
          }
          default:
            return yield* Effect.fail(toolFailure(`Unknown workspace file artifact view: ${view}`));
        }
      });
    }
  }),
);

function workspaceCapabilities() {
  return [
    capability("schema-ide.workspace.decodedWorkspace", "schema-ide.workspace", "decodedWorkspace"),
    capability("schema-ide.workspace.diagnostics", "schema-ide.workspace", "diagnostics"),
    capability(
      "schema-ide.workspace.validationSummary",
      "schema-ide.workspace",
      "validationSummary",
    ),
    capability("schema-ide.workspace.routeMatches", "schema-ide.workspace", "routeMatches"),
    capability("schema-ide.workspace.reflection", "schema-ide.workspace", "reflection"),
  ];
}

function fileCapabilities(routeId?: string, routePattern?: string) {
  const type = "schema-ide.workspace-file";
  return [
    capability("schema-ide.workspace-file.sourceText", type, "sourceText", routeId, routePattern),
    capability("schema-ide.workspace-file.parsedValue", type, "parsedValue", routeId, routePattern),
    capability("schema-ide.workspace-file.jsonSchema", type, "jsonSchema", routeId, routePattern),
    capability("schema-ide.workspace-file.diagnostics", type, "diagnostics", routeId, routePattern),
  ];
}

function capability(
  id: string,
  type: string,
  view: string,
  routeId?: string,
  routePattern?: string,
) {
  return {
    id,
    type,
    view,
    annotations: {},
    ...(routeId ? { routeId } : {}),
    ...(routePattern ? { routePattern } : {}),
  };
}
