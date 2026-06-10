import { Context, Effect, Schema, Stream } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const IngestorAcceptsSchema = Schema.Struct({
  mimeType: Schema.optional(Schema.String),
  mediaType: Schema.optional(Schema.String),
  extension: Schema.optional(Schema.String),
});

export type IngestorAcceptsDto = typeof IngestorAcceptsSchema.Type;

export const ArtifactWorkflowIngestorSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  accepts: Schema.Array(IngestorAcceptsSchema),
  targetRoutes: Schema.Array(Schema.String),
  creates: Schema.Array(Schema.String),
  write: Schema.Literals(["apply", "propose"]),
  workflowId: Schema.String,
  uses: Schema.Array(Schema.String),
  inputJsonSchema: Schema.Unknown,
});

export type ArtifactWorkflowIngestorDto = typeof ArtifactWorkflowIngestorSchema.Type;

export const ListArtifactWorkflowIngestorsResponseSchema = Schema.Struct({
  ingestors: Schema.Array(ArtifactWorkflowIngestorSchema),
});

export type ListArtifactWorkflowIngestorsResponse =
  typeof ListArtifactWorkflowIngestorsResponseSchema.Type;

export const StartArtifactWorkflowRunRequestSchema = Schema.Struct({
  ingestorId: Schema.String,
  sourcePath: Schema.String,
  sourceContent: Schema.optional(Schema.String),
  inputs: Schema.Record(Schema.String, Schema.Unknown),
  writeMode: Schema.optional(Schema.Literals(["apply", "propose"])),
});

export type StartArtifactWorkflowRunRequest = typeof StartArtifactWorkflowRunRequestSchema.Type;

export const ArtifactWorkflowStepCostSchema = Schema.Struct({
  tokens: Schema.optional(Schema.Number),
  inputTokens: Schema.optional(Schema.Number),
  outputTokens: Schema.optional(Schema.Number),
  usd: Schema.optional(Schema.Number),
});

export type ArtifactWorkflowStepCostDto = typeof ArtifactWorkflowStepCostSchema.Type;

export const ArtifactWorkflowStepRecordSchema = Schema.Struct({
  stepId: Schema.String,
  actionId: Schema.String,
  status: Schema.Literals(["pending", "running", "skipped", "completed", "failed"]),
  inputHash: Schema.optional(Schema.String),
  outputHash: Schema.optional(Schema.String),
  startedAt: Schema.optional(Schema.String),
  completedAt: Schema.optional(Schema.String),
  diagnostics: Schema.optional(Schema.Array(Schema.String)),
  writes: Schema.Array(Schema.Struct({ path: Schema.String, content: Schema.String })),
  provenance: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      runId: Schema.String,
      stepId: Schema.String,
      actionId: Schema.String,
    }),
  ),
  cost: Schema.optional(ArtifactWorkflowStepCostSchema),
});

export type ArtifactWorkflowStepRecordDto = typeof ArtifactWorkflowStepRecordSchema.Type;

export const ArtifactWorkflowPatchProposalSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  edits: Schema.Array(Schema.Struct({ path: Schema.String, content: Schema.String })),
  validation: Schema.optional(Schema.Unknown),
  diagnostics: Schema.optional(Schema.Unknown),
});

export const ArtifactWorkflowRunManifestSchema = Schema.Struct({
  version: Schema.Literal(1),
  runId: Schema.String,
  workflowId: Schema.String,
  status: Schema.Literals(["running", "completed", "failed", "waiting"]),
  writeMode: Schema.Literals(["apply", "propose"]),
  inputHash: Schema.String,
  startedAt: Schema.String,
  updatedAt: Schema.String,
  steps: Schema.Record(Schema.String, ArtifactWorkflowStepRecordSchema),
  output: Schema.optional(Schema.Unknown),
  patch: Schema.optional(ArtifactWorkflowPatchProposalSchema),
});

export type ArtifactWorkflowRunManifestDto = typeof ArtifactWorkflowRunManifestSchema.Type;

export const ArtifactWorkflowRunReportSchema = Schema.Struct({
  runId: Schema.String,
  status: Schema.Literals(["running", "completed", "failed", "waiting"]),
  manifest: ArtifactWorkflowRunManifestSchema,
  output: Schema.optional(Schema.Unknown),
  patch: Schema.optional(ArtifactWorkflowPatchProposalSchema),
});

export type ArtifactWorkflowRunReportDto = typeof ArtifactWorkflowRunReportSchema.Type;

export const ArtifactWorkflowStepEventSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("run-started"),
    runId: Schema.String,
    workflowId: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("step-started"),
    runId: Schema.String,
    stepId: Schema.String,
    actionId: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("step-completed"),
    runId: Schema.String,
    step: ArtifactWorkflowStepRecordSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("step-failed"),
    runId: Schema.String,
    step: ArtifactWorkflowStepRecordSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("run-completed"),
    report: ArtifactWorkflowRunReportSchema,
  }),
]);

export type ArtifactWorkflowStepEventDto = typeof ArtifactWorkflowStepEventSchema.Type;

export const WatchArtifactWorkflowRunRequestSchema = Schema.Struct({
  runId: Schema.String,
});

export const ResumeArtifactWorkflowRunRequestSchema = Schema.Struct({
  runId: Schema.String,
  fromStep: Schema.optional(Schema.String),
});

export const GetArtifactWorkflowRunReportRequestSchema = Schema.Struct({
  runId: Schema.String,
});

export const ArtifactWorkflowRpcErrorSchema = Schema.Struct({
  message: Schema.String,
  code: Schema.Literals(["not-found", "invalid-input", "capability", "storage", "unsupported"]),
});

export type ArtifactWorkflowRpcError = typeof ArtifactWorkflowRpcErrorSchema.Type;

export class SchematicsArtifactWorkflowRpcGroup extends RpcGroup.make(
  Rpc.make("ListArtifactWorkflowIngestors", {
    success: ListArtifactWorkflowIngestorsResponseSchema,
    error: ArtifactWorkflowRpcErrorSchema,
  }),
  Rpc.make("StartArtifactWorkflowRun", {
    payload: StartArtifactWorkflowRunRequestSchema,
    success: ArtifactWorkflowRunReportSchema,
    error: ArtifactWorkflowRpcErrorSchema,
  }),
  Rpc.make("WatchArtifactWorkflowRun", {
    payload: WatchArtifactWorkflowRunRequestSchema,
    success: ArtifactWorkflowStepEventSchema,
    error: ArtifactWorkflowRpcErrorSchema,
    stream: true,
  }),
  Rpc.make("ResumeArtifactWorkflowRun", {
    payload: ResumeArtifactWorkflowRunRequestSchema,
    success: ArtifactWorkflowRunReportSchema,
    error: ArtifactWorkflowRpcErrorSchema,
  }),
  Rpc.make("GetArtifactWorkflowRunReport", {
    payload: GetArtifactWorkflowRunReportRequestSchema,
    success: ArtifactWorkflowRunReportSchema,
    error: ArtifactWorkflowRpcErrorSchema,
  }),
) {}

export interface SchematicsArtifactWorkflowService {
  readonly listIngestors: Effect.Effect<
    ListArtifactWorkflowIngestorsResponse,
    ArtifactWorkflowRpcError
  >;
  readonly startRun: (
    request: StartArtifactWorkflowRunRequest,
  ) => Effect.Effect<ArtifactWorkflowRunReportDto, ArtifactWorkflowRpcError>;
  readonly watchRun: (
    request: typeof WatchArtifactWorkflowRunRequestSchema.Type,
  ) => Stream.Stream<ArtifactWorkflowStepEventDto, ArtifactWorkflowRpcError>;
  readonly resumeRun: (
    request: typeof ResumeArtifactWorkflowRunRequestSchema.Type,
  ) => Effect.Effect<ArtifactWorkflowRunReportDto, ArtifactWorkflowRpcError>;
  readonly getRunReport: (
    request: typeof GetArtifactWorkflowRunReportRequestSchema.Type,
  ) => Effect.Effect<ArtifactWorkflowRunReportDto, ArtifactWorkflowRpcError>;
}

export class SchematicsArtifactWorkflow extends Context.Service<
  SchematicsArtifactWorkflow,
  SchematicsArtifactWorkflowService
>()("schematics/SchematicsArtifactWorkflow") {}
