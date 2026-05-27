import { Context, Effect, Schema, Stream } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const SourceFileSchema = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
});

export type SourceFileDto = typeof SourceFileSchema.Type;

export const SchemaIdeDocumentFormatSchema = Schema.Literals(["json", "yaml"]);

export type SchemaIdeDocumentFormatDto = typeof SchemaIdeDocumentFormatSchema.Type;

export const SchemaIdeDiagnosticSourceSchema = Schema.Literals([
  "json-parse",
  "yaml-parse",
  "schema",
  "workspace",
  "cross-file",
]);

export const SchemaIdeDiagnosticSchema = Schema.Struct({
  path: Schema.NullOr(Schema.String),
  documentPath: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Number),
  column: Schema.optional(Schema.Number),
  severity: Schema.Literals(["error", "warning", "info"]),
  message: Schema.String,
  source: SchemaIdeDiagnosticSourceSchema,
});

export type SchemaIdeDiagnosticDto = typeof SchemaIdeDiagnosticSchema.Type;

export const SchemaIdeValidationSummarySchema = Schema.Struct({
  valid: Schema.Boolean,
  errorCount: Schema.Number,
  warningCount: Schema.Number,
  infoCount: Schema.Number,
});

export type SchemaIdeValidationSummaryDto = typeof SchemaIdeValidationSummarySchema.Type;

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
  format: SchemaIdeDocumentFormatSchema,
});

export const SchemaIdeReflectionSchema = Schema.Struct({
  mode: Schema.Literals(["document", "workspace"]),
  activeFile: Schema.NullOr(Schema.String),
  activeFormat: SchemaIdeDocumentFormatSchema,
  files: Schema.Array(SourceFileSchema),
  schemas: Schema.Array(ReflectedSchemaSchema),
  activeJsonSchema: Schema.NullOr(Schema.Unknown),
  decodedValue: Schema.NullOr(Schema.Unknown),
  diagnostics: Schema.Array(SchemaIdeDiagnosticSchema),
  validationSummary: SchemaIdeValidationSummarySchema,
  routeMatches: Schema.Array(RouteMatchSchema),
});

export type SchemaIdeReflectionDto = typeof SchemaIdeReflectionSchema.Type;

export const WorkspaceCapabilitiesSchema = Schema.Struct({
  mode: Schema.Literals(["memory", "local-filesystem", "remote"]),
  workspace: Schema.Struct({
    id: Schema.optional(Schema.String),
    title: Schema.optional(Schema.String),
    readOnly: Schema.Boolean,
  }),
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

export type WorkspaceCapabilities = typeof WorkspaceCapabilitiesSchema.Type;

export const WorkspaceSnapshotSchema = Schema.Struct({
  revision: Schema.Number,
  files: Schema.Array(SourceFileSchema),
  reflection: SchemaIdeReflectionSchema,
});

export type WorkspaceSnapshot = typeof WorkspaceSnapshotSchema.Type;

export const WorkspaceEventSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    snapshot: WorkspaceSnapshotSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("capabilities"),
    capabilities: WorkspaceCapabilitiesSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("error"),
    message: Schema.String,
  }),
]);

export type WorkspaceEvent = typeof WorkspaceEventSchema.Type;

export const WorkspaceChangeRequestSchema = Schema.Union([
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

export type WorkspaceChangeRequest = typeof WorkspaceChangeRequestSchema.Type;

export const WorkspaceChangeResponseSchema = Schema.Struct({
  revision: Schema.Number,
  changedPaths: Schema.Array(Schema.String),
  validationSummary: SchemaIdeValidationSummarySchema,
});

export type WorkspaceChangeResponse = typeof WorkspaceChangeResponseSchema.Type;

export const WorkspacePreviewRequestSchema = Schema.Struct({
  files: Schema.Array(SourceFileSchema),
  activeFile: Schema.optional(Schema.NullOr(Schema.String)),
});

export type WorkspacePreviewRequest = typeof WorkspacePreviewRequestSchema.Type;

export const WorkspacePreviewResponseSchema = Schema.Struct({
  reflection: SchemaIdeReflectionSchema,
});

export type WorkspacePreviewResponse = typeof WorkspacePreviewResponseSchema.Type;

export const WorkspaceToolRunRequestSchema = Schema.Struct({
  toolId: Schema.String,
  target: Schema.optional(Schema.NullOr(Schema.String)),
  parameters: Schema.optional(Schema.Unknown),
  model: Schema.optional(Schema.String),
  outputRoot: Schema.optional(Schema.String),
  dryRun: Schema.optional(Schema.Boolean),
});

export type WorkspaceToolRunRequest = typeof WorkspaceToolRunRequestSchema.Type;

export const WorkspaceToolRunResponseSchema = Schema.Struct({
  status: Schema.Literal("unavailable"),
  toolIds: Schema.Array(Schema.String),
  target: Schema.NullOr(Schema.String),
  message: Schema.String,
});

export type WorkspaceToolRunResponse = typeof WorkspaceToolRunResponseSchema.Type;

export const WorkspaceRpcErrorSchema = Schema.Struct({
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

export type WorkspaceRpcError = typeof WorkspaceRpcErrorSchema.Type;

export class SchemaIdeWorkspaceRpcGroup extends RpcGroup.make(
  Rpc.make("GetCapabilities", {
    success: WorkspaceCapabilitiesSchema,
    error: WorkspaceRpcErrorSchema,
  }),
  Rpc.make("GetSnapshot", {
    success: WorkspaceSnapshotSchema,
    error: WorkspaceRpcErrorSchema,
  }),
  Rpc.make("WatchWorkspace", {
    success: WorkspaceEventSchema,
    error: WorkspaceRpcErrorSchema,
    stream: true,
  }),
  Rpc.make("ApplyWorkspaceChange", {
    payload: WorkspaceChangeRequestSchema,
    success: WorkspaceChangeResponseSchema,
    error: WorkspaceRpcErrorSchema,
  }),
  Rpc.make("PreviewWorkspaceFiles", {
    payload: WorkspacePreviewRequestSchema,
    success: WorkspacePreviewResponseSchema,
    error: WorkspaceRpcErrorSchema,
  }),
  Rpc.make("RunWorkspaceTool", {
    payload: WorkspaceToolRunRequestSchema,
    success: WorkspaceToolRunResponseSchema,
    error: WorkspaceRpcErrorSchema,
  }),
) {}

export interface SchemaIdeWorkspaceService {
  readonly getCapabilities: Effect.Effect<WorkspaceCapabilities, SchemaIdeWorkspaceError>;
  readonly getSnapshot: Effect.Effect<WorkspaceSnapshot, SchemaIdeWorkspaceError>;
  readonly watchWorkspace: Stream.Stream<WorkspaceEvent, SchemaIdeWorkspaceError>;
  readonly applyChange: (
    change: WorkspaceChangeRequest,
  ) => Effect.Effect<WorkspaceChangeResponse, SchemaIdeWorkspaceError>;
  readonly previewFiles: (
    request: WorkspacePreviewRequest,
  ) => Effect.Effect<WorkspacePreviewResponse, SchemaIdeWorkspaceError>;
  readonly runTool: (
    request: WorkspaceToolRunRequest,
  ) => Effect.Effect<WorkspaceToolRunResponse, SchemaIdeWorkspaceError>;
}

export class SchemaIdeWorkspace extends Context.Service<
  SchemaIdeWorkspace,
  SchemaIdeWorkspaceService
>()("schema-ide/SchemaIdeWorkspace") {}

export class SchemaIdeWorkspaceError extends Error {
  readonly _tag = "SchemaIdeWorkspaceError" as const;

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
    this.name = "SchemaIdeWorkspaceError";
  }
}

export function isSchemaIdeWorkspaceError(error: unknown): error is SchemaIdeWorkspaceError {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "SchemaIdeWorkspaceError"
  );
}

export function toWorkspaceRpcError(error: unknown): WorkspaceRpcError {
  if (isSchemaIdeWorkspaceError(error)) {
    return { message: error.message, code: error.code };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    code: "storage",
  };
}

export function workspaceRpcErrorToError(error: WorkspaceRpcError): SchemaIdeWorkspaceError {
  return new SchemaIdeWorkspaceError(error.message, error.code);
}
