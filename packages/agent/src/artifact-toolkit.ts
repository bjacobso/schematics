import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import { ToolFailure, ValidationSummary } from "./common-toolkit-schemas";
import { MutationResult } from "./workspace-schemas";
import { SchemaIdeWorkspace } from "./schema-ide-workspace";

const ArtifactRefSchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Project"),
    projectId: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    _tag: Schema.Literal("ProjectFile"),
    path: Schema.String,
    projectId: Schema.optional(Schema.String),
  }),
]);

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
  description: "Return the declared artifact views available for a project or project file ref.",
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
  description: "Replace the sourceText view of a project file artifact.",
  parameters: Schema.Struct({
    ref: Schema.Struct({
      _tag: Schema.Literal("ProjectFile"),
      path: Schema.String,
      projectId: Schema.optional(Schema.String),
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
        return yield* workspace.listArtifacts;
      }),
      get_artifact_capabilities: Effect.fn("ArtifactToolkit.get_artifact_capabilities")(function* ({
        ref,
      }) {
        return yield* workspace.getArtifactCapabilities(ref);
      }),
      read_artifact_view: Effect.fn("ArtifactToolkit.read_artifact_view")(function* ({
        ref,
        view,
      }) {
        return yield* workspace.readArtifactView({ ref, view });
      }),
      write_artifact_source: Effect.fn("ArtifactToolkit.write_artifact_source")(function* ({
        ref,
        content,
      }) {
        return yield* workspace.writeArtifactSource(ref, content);
      }),
      validate_artifact_project: Effect.fn("ArtifactToolkit.validate_artifact_project")(
        function* () {
          const workspaceRef = { _tag: "Project" as const };
          const summary = yield* workspace.readArtifactView({
            ref: workspaceRef,
            view: "validationSummary",
          });
          const diagnostics = yield* workspace.readArtifactView({
            ref: workspaceRef,
            view: "diagnostics",
          });
          const routeMatches = yield* workspace.readArtifactView({
            ref: workspaceRef,
            view: "routeMatches",
          });
          return {
            summary: summary.value as typeof ValidationSummary.Type,
            diagnostics: Array.isArray(diagnostics.value) ? diagnostics.value : [],
            routeMatches: Array.isArray(routeMatches.value) ? routeMatches.value : [],
          };
        },
      ),
    });
  }),
);
