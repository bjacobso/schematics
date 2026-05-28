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

export const ArtifactRefSchema = Schema.Union([
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
    _tag: Schema.Literal("WorkspaceFile"),
    path: Schema.String,
    workspaceId: Schema.optional(Schema.String),
  }),
  content: Schema.String,
});

export type ArtifactChangeRequest = typeof ArtifactChangeRequestSchema.Type;

export const ArtifactChangeResponseSchema = WorkspaceChangeResponseSchema;

export type ArtifactChangeResponse = typeof ArtifactChangeResponseSchema.Type;

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
  Rpc.make("ListArtifactRefs", {
    success: ListArtifactRefsResponseSchema,
    error: WorkspaceRpcErrorSchema,
  }),
  Rpc.make("GetArtifactCapabilities", {
    payload: GetArtifactCapabilitiesRequestSchema,
    success: GetArtifactCapabilitiesResponseSchema,
    error: WorkspaceRpcErrorSchema,
  }),
  Rpc.make("ReadArtifactView", {
    payload: ReadArtifactViewRequestSchema,
    success: ReadArtifactViewResponseSchema,
    error: WorkspaceRpcErrorSchema,
  }),
  Rpc.make("ApplyArtifactChange", {
    payload: ArtifactChangeRequestSchema,
    success: ArtifactChangeResponseSchema,
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
  readonly listArtifactRefs: Effect.Effect<ListArtifactRefsResponse, SchemaIdeWorkspaceError>;
  readonly getArtifactCapabilities: (
    request: GetArtifactCapabilitiesRequest,
  ) => Effect.Effect<GetArtifactCapabilitiesResponse, SchemaIdeWorkspaceError>;
  readonly readArtifactView: (
    request: ReadArtifactViewRequest,
  ) => Effect.Effect<ReadArtifactViewResponse, SchemaIdeWorkspaceError>;
  readonly applyArtifactChange: (
    change: ArtifactChangeRequest,
  ) => Effect.Effect<ArtifactChangeResponse, SchemaIdeWorkspaceError>;
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

export function listArtifactRefsFromSnapshot(
  snapshot: WorkspaceSnapshot,
  workspaceId?: string | undefined,
): ListArtifactRefsResponse {
  const artifacts: ArtifactRef[] = [
    workspaceId ? { _tag: "Workspace", workspaceId } : { _tag: "Workspace" },
    ...snapshot.files.map((file) =>
      workspaceId
        ? ({ _tag: "WorkspaceFile", path: file.path, workspaceId } as const)
        : ({ _tag: "WorkspaceFile", path: file.path } as const),
    ),
  ];
  return { artifacts, count: artifacts.length };
}

export function getArtifactCapabilitiesFromSnapshot({
  snapshot,
  ref,
}: {
  readonly snapshot: WorkspaceSnapshot;
  readonly ref: ArtifactRef;
}): GetArtifactCapabilitiesResponse {
  return {
    capabilities:
      ref._tag === "Workspace"
        ? workspaceArtifactCapabilities()
        : fileArtifactCapabilities(snapshot, ref.path),
  };
}

export function readArtifactViewFromSnapshot({
  snapshot,
  ref,
  view,
}: ReadArtifactViewRequest & {
  readonly snapshot: WorkspaceSnapshot;
}): ReadArtifactViewResponse {
  if (ref._tag === "Workspace") {
    return { ref, view, value: readWorkspaceArtifactView(snapshot, view) };
  }
  return { ref, view, value: readWorkspaceFileArtifactView(snapshot, ref.path, view) };
}

export function artifactChangeToWorkspaceChange(
  change: ArtifactChangeRequest,
): WorkspaceChangeRequest {
  return {
    type: "writeFile",
    path: change.ref.path,
    content: change.content,
  };
}

function workspaceArtifactCapabilities(): readonly ArtifactCapability[] {
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

function fileArtifactCapabilities(
  snapshot: WorkspaceSnapshot,
  path: string,
): readonly ArtifactCapability[] {
  const route = snapshot.reflection.routeMatches.find((candidate) => candidate.path === path);
  const routeId = route?.schemaId ?? undefined;
  const routePattern = routeId
    ? snapshot.reflection.schemas.find((schema) => schema.id === routeId)?.match
    : undefined;
  const type = "schema-ide.workspace-file";
  return [
    capability("schema-ide.workspace-file.sourceText", type, "sourceText", routeId, routePattern),
    capability("schema-ide.workspace-file.jsonSchema", type, "jsonSchema", routeId, routePattern),
    capability("schema-ide.workspace-file.diagnostics", type, "diagnostics", routeId, routePattern),
  ];
}

function readWorkspaceArtifactView(snapshot: WorkspaceSnapshot, view: string): unknown {
  switch (view) {
    case "decodedWorkspace":
      return snapshot.reflection.decodedValue;
    case "diagnostics":
      return snapshot.reflection.diagnostics;
    case "validationSummary":
      return snapshot.reflection.validationSummary;
    case "routeMatches":
      return snapshot.reflection.routeMatches;
    case "reflection":
      return snapshot.reflection;
    default:
      throw new SchemaIdeWorkspaceError(`Unknown workspace artifact view: ${view}`, "unsupported");
  }
}

function readWorkspaceFileArtifactView(
  snapshot: WorkspaceSnapshot,
  path: string,
  view: string,
): unknown {
  const file = snapshot.files.find((candidate) => candidate.path === path);
  if (!file) throw new SchemaIdeWorkspaceError(`File not found: ${path}`, "not-found");

  switch (view) {
    case "sourceText":
      return file.content;
    case "jsonSchema": {
      const route = snapshot.reflection.routeMatches.find((candidate) => candidate.path === path);
      if (!route?.schemaId) return null;
      return (
        snapshot.reflection.schemas.find((schema) => schema.id === route.schemaId)?.jsonSchema ??
        null
      );
    }
    case "diagnostics":
      return snapshot.reflection.diagnostics.filter(
        (diagnostic) => diagnostic.path === path || diagnostic.path === null,
      );
    default:
      throw new SchemaIdeWorkspaceError(
        `Unknown workspace file artifact view: ${view}`,
        "unsupported",
      );
  }
}

function capability(
  id: string,
  type: string,
  view: string,
  routeId?: string | undefined,
  routePattern?: string | undefined,
): ArtifactCapability {
  return {
    id,
    type,
    view,
    annotations: {},
    ...(routeId ? { routeId } : {}),
    ...(routePattern ? { routePattern } : {}),
  };
}
