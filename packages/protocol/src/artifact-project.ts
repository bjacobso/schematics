import { Context, Effect, Schema, Stream } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const SourceFileSchema = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
});

export type SourceFileDto = typeof SourceFileSchema.Type;

export const SchematicsDocumentFormatSchema = Schema.Literals(["json", "yaml"]);

export type SchematicsDocumentFormatDto = typeof SchematicsDocumentFormatSchema.Type;

export const SchematicsDiagnosticSourceSchema = Schema.Literals([
  "json-parse",
  "yaml-parse",
  "schema",
  "workspace",
  "cross-file",
]);

export const SchematicsDiagnosticSchema = Schema.Struct({
  path: Schema.NullOr(Schema.String),
  documentPath: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Number),
  column: Schema.optional(Schema.Number),
  severity: Schema.Literals(["error", "warning", "info"]),
  message: Schema.String,
  source: SchematicsDiagnosticSourceSchema,
});

export type SchematicsDiagnosticDto = typeof SchematicsDiagnosticSchema.Type;

export const SchematicsValidationSummarySchema = Schema.Struct({
  valid: Schema.Boolean,
  errorCount: Schema.Number,
  warningCount: Schema.Number,
  infoCount: Schema.Number,
});

export type SchematicsValidationSummaryDto = typeof SchematicsValidationSummarySchema.Type;

export const ReflectedSchemaSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  match: Schema.optional(Schema.String),
  jsonSchema: Schema.Unknown,
});

export const RouteMatchSchema = Schema.Struct({
  path: Schema.String,
  schemaId: Schema.NullOr(Schema.String),
  format: SchematicsDocumentFormatSchema,
});

export const SchematicsReflectionSchema = Schema.Struct({
  mode: Schema.Literals(["document", "workspace"]),
  activeFile: Schema.NullOr(Schema.String),
  activeFormat: SchematicsDocumentFormatSchema,
  files: Schema.Array(SourceFileSchema),
  schemas: Schema.Array(ReflectedSchemaSchema),
  activeJsonSchema: Schema.NullOr(Schema.Unknown),
  decodedValue: Schema.NullOr(Schema.Unknown),
  diagnostics: Schema.Array(SchematicsDiagnosticSchema),
  validationSummary: SchematicsValidationSummarySchema,
  routeMatches: Schema.Array(RouteMatchSchema),
});

export type SchematicsReflectionDto = typeof SchematicsReflectionSchema.Type;

const ArtifactProjectMetadataSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  readOnly: Schema.Boolean,
});

export const ArtifactProjectCapabilitiesSchema = Schema.Struct({
  mode: Schema.Literals(["memory", "local-filesystem", "remote"]),
  project: ArtifactProjectMetadataSchema,
  agent: Schema.Struct({
    enabled: Schema.Boolean,
    reason: Schema.optional(Schema.String),
  }),
  features: Schema.Struct({
    watch: Schema.Boolean,
    write: Schema.Boolean,
    rename: Schema.Boolean,
    delete: Schema.Boolean,
    history: Schema.Boolean,
    previews: Schema.Boolean,
  }),
});

export type ArtifactProjectCapabilities = typeof ArtifactProjectCapabilitiesSchema.Type;

export const ArtifactProjectSnapshotSchema = Schema.Struct({
  revision: Schema.Number,
  files: Schema.Array(SourceFileSchema),
});

export type ArtifactProjectSnapshot = typeof ArtifactProjectSnapshotSchema.Type;

export const ArtifactProjectEventSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    snapshot: ArtifactProjectSnapshotSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("capabilities"),
    capabilities: ArtifactProjectCapabilitiesSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("error"),
    message: Schema.String,
  }),
]);

export type ArtifactProjectEvent = typeof ArtifactProjectEventSchema.Type;

export const ArtifactProjectChangeRequestSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("writeFile"),
    path: Schema.String,
    content: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("createFile"),
    path: Schema.String,
    content: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("deleteFile"),
    path: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("renameFile"),
    fromPath: Schema.String,
    toPath: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("replaceFiles"),
    files: Schema.Array(SourceFileSchema),
  }),
]);

export type ArtifactProjectChangeRequest = typeof ArtifactProjectChangeRequestSchema.Type;

export const ArtifactProjectChangeResponseSchema = Schema.Struct({
  revision: Schema.Number,
  changedPaths: Schema.Array(Schema.String),
  validationSummary: SchematicsValidationSummarySchema,
});

export type ArtifactProjectChangeResponse = typeof ArtifactProjectChangeResponseSchema.Type;

export const ArtifactProjectPreviewRequestSchema = Schema.Struct({
  files: Schema.Array(SourceFileSchema),
  activeFile: Schema.optional(Schema.NullOr(Schema.String)),
});

export type ArtifactProjectPreviewRequest = typeof ArtifactProjectPreviewRequestSchema.Type;

export const ArtifactProjectPreviewResponseSchema = Schema.Struct({
  reflection: SchematicsReflectionSchema,
});

export type ArtifactProjectPreviewResponse = typeof ArtifactProjectPreviewResponseSchema.Type;

export const ArtifactRefSchema = Schema.Union([
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

export type ArtifactRef = typeof ArtifactRefSchema.Type;

export const ArtifactCapabilitySchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  view: Schema.String,
  routeId: Schema.optional(Schema.String),
  routePattern: Schema.optional(Schema.String),
  annotations: Schema.Unknown,
});

export type ArtifactCapability = typeof ArtifactCapabilitySchema.Type;

export const ListArtifactRefsResponseSchema = Schema.Struct({
  artifacts: Schema.Array(ArtifactRefSchema),
  count: Schema.Number,
});

export type ListArtifactRefsResponse = typeof ListArtifactRefsResponseSchema.Type;

export const GetArtifactCapabilitiesRequestSchema = Schema.Struct({
  ref: ArtifactRefSchema,
});

export type GetArtifactCapabilitiesRequest = typeof GetArtifactCapabilitiesRequestSchema.Type;

export const GetArtifactCapabilitiesResponseSchema = Schema.Struct({
  capabilities: Schema.Array(ArtifactCapabilitySchema),
});

export type GetArtifactCapabilitiesResponse = typeof GetArtifactCapabilitiesResponseSchema.Type;

export const ReadArtifactViewRequestSchema = Schema.Struct({
  ref: ArtifactRefSchema,
  view: Schema.String,
});

export type ReadArtifactViewRequest = typeof ReadArtifactViewRequestSchema.Type;

export const ReadArtifactViewResponseSchema = Schema.Struct({
  ref: ArtifactRefSchema,
  view: Schema.String,
  value: Schema.Unknown,
});

export type ReadArtifactViewResponse = typeof ReadArtifactViewResponseSchema.Type;

export const ArtifactChangeRequestSchema = Schema.Struct({
  type: Schema.Literal("writeSource"),
  ref: Schema.Struct({
    _tag: Schema.Literal("ProjectFile"),
    path: Schema.String,
    projectId: Schema.optional(Schema.String),
  }),
  content: Schema.String,
});

export type ArtifactChangeRequest = typeof ArtifactChangeRequestSchema.Type;

export const ArtifactChangeResponseSchema = ArtifactProjectChangeResponseSchema;

export type ArtifactChangeResponse = typeof ArtifactChangeResponseSchema.Type;

export const ArtifactProjectRpcErrorSchema = Schema.Struct({
  message: Schema.String,
  code: Schema.Literals([
    "unsafe-path",
    "not-found",
    "already-exists",
    "read-only",
    "unsupported",
    "storage",
  ]),
});

export type ArtifactProjectRpcError = typeof ArtifactProjectRpcErrorSchema.Type;

export class SchematicsArtifactProjectRpcGroup extends RpcGroup.make(
  Rpc.make("GetCapabilities", {
    success: ArtifactProjectCapabilitiesSchema,
    error: ArtifactProjectRpcErrorSchema,
  }),
  Rpc.make("GetSnapshot", {
    success: ArtifactProjectSnapshotSchema,
    error: ArtifactProjectRpcErrorSchema,
  }),
  Rpc.make("WatchArtifactProject", {
    success: ArtifactProjectEventSchema,
    error: ArtifactProjectRpcErrorSchema,
    stream: true,
  }),
  Rpc.make("ApplyArtifactProjectChange", {
    payload: ArtifactProjectChangeRequestSchema,
    success: ArtifactProjectChangeResponseSchema,
    error: ArtifactProjectRpcErrorSchema,
  }),
  Rpc.make("PreviewArtifactProjectFiles", {
    payload: ArtifactProjectPreviewRequestSchema,
    success: ArtifactProjectPreviewResponseSchema,
    error: ArtifactProjectRpcErrorSchema,
  }),
  Rpc.make("ListArtifactRefs", {
    success: ListArtifactRefsResponseSchema,
    error: ArtifactProjectRpcErrorSchema,
  }),
  Rpc.make("GetArtifactCapabilities", {
    payload: GetArtifactCapabilitiesRequestSchema,
    success: GetArtifactCapabilitiesResponseSchema,
    error: ArtifactProjectRpcErrorSchema,
  }),
  Rpc.make("ReadArtifactView", {
    payload: ReadArtifactViewRequestSchema,
    success: ReadArtifactViewResponseSchema,
    error: ArtifactProjectRpcErrorSchema,
  }),
  Rpc.make("ApplyArtifactChange", {
    payload: ArtifactChangeRequestSchema,
    success: ArtifactChangeResponseSchema,
    error: ArtifactProjectRpcErrorSchema,
  }),
) {}

export interface SchematicsArtifactProjectService {
  readonly getCapabilities: Effect.Effect<
    ArtifactProjectCapabilities,
    SchematicsArtifactProjectError
  >;
  readonly getSnapshot: Effect.Effect<ArtifactProjectSnapshot, SchematicsArtifactProjectError>;
  readonly watchArtifactProject: Stream.Stream<
    ArtifactProjectEvent,
    SchematicsArtifactProjectError
  >;
  readonly applyChange: (
    change: ArtifactProjectChangeRequest,
  ) => Effect.Effect<ArtifactProjectChangeResponse, SchematicsArtifactProjectError>;
  readonly previewFiles: (
    request: ArtifactProjectPreviewRequest,
  ) => Effect.Effect<ArtifactProjectPreviewResponse, SchematicsArtifactProjectError>;
  readonly listArtifactRefs: Effect.Effect<
    ListArtifactRefsResponse,
    SchematicsArtifactProjectError
  >;
  readonly getArtifactCapabilities: (
    request: GetArtifactCapabilitiesRequest,
  ) => Effect.Effect<GetArtifactCapabilitiesResponse, SchematicsArtifactProjectError>;
  readonly readArtifactView: (
    request: ReadArtifactViewRequest,
  ) => Effect.Effect<ReadArtifactViewResponse, SchematicsArtifactProjectError>;
  readonly applyArtifactChange: (
    change: ArtifactChangeRequest,
  ) => Effect.Effect<ArtifactChangeResponse, SchematicsArtifactProjectError>;
}

export class SchematicsArtifactProject extends Context.Service<
  SchematicsArtifactProject,
  SchematicsArtifactProjectService
>()("schematics/SchematicsArtifactProject") {}

export class SchematicsArtifactProjectError extends Error {
  readonly _tag = "SchematicsArtifactProjectError" as const;

  constructor(
    message: string,
    readonly code:
      | "unsafe-path"
      | "not-found"
      | "already-exists"
      | "read-only"
      | "unsupported"
      | "storage",
  ) {
    super(message);
    this.name = "SchematicsArtifactProjectError";
  }
}

export function isSchematicsArtifactProjectError(
  error: unknown,
): error is SchematicsArtifactProjectError {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "SchematicsArtifactProjectError"
  );
}

export function toArtifactProjectRpcError(error: unknown): ArtifactProjectRpcError {
  if (isSchematicsArtifactProjectError(error)) {
    return { message: error.message, code: error.code };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    code: "storage",
  };
}

export function artifactProjectRpcErrorToError(
  error: ArtifactProjectRpcError,
): SchematicsArtifactProjectError {
  return new SchematicsArtifactProjectError(error.message, error.code);
}

export function listArtifactRefsFromSnapshot(
  snapshot: ArtifactProjectSnapshot,
  projectId?: string | undefined,
): ListArtifactRefsResponse {
  const artifacts: ArtifactRef[] = [
    projectId ? { _tag: "Project", projectId } : { _tag: "Project" },
    ...snapshot.files.map((file) =>
      projectId
        ? ({ _tag: "ProjectFile", path: file.path, projectId } as const)
        : ({ _tag: "ProjectFile", path: file.path } as const),
    ),
  ];
  return { artifacts, count: artifacts.length };
}

export function artifactChangeToProjectChange(
  change: ArtifactChangeRequest,
): ArtifactProjectChangeRequest {
  return {
    type: "writeFile",
    path: change.ref.path,
    content: change.content,
  };
}
