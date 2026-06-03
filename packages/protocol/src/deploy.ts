import { Context, Effect, Schema, Stream } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

// ── Plan / change schemas (mirror @schema-ide/config-deploy wire types) ───────

export const DeployFieldChangeSchema = Schema.Struct({
  /** Dotted path to the field, or "(root)" for a top-level scalar/array swap. */
  path: Schema.String,
  before: Schema.Unknown,
  after: Schema.Unknown,
});

export type DeployFieldChange = typeof DeployFieldChangeSchema.Type;

export const DeployChangeActionSchema = Schema.Literals(["create", "update", "delete", "noop"]);

export type DeployChangeAction = typeof DeployChangeActionSchema.Type;

export const DeployResourceChangeSchema = Schema.Struct({
  kind: Schema.String,
  /** Human slug (file identity). */
  key: Schema.String,
  /** Opaque remote id resolved via the lockfile; null for creates. */
  remoteId: Schema.NullOr(Schema.String),
  path: Schema.String,
  action: DeployChangeActionSchema,
  before: Schema.NullOr(Schema.Unknown),
  after: Schema.NullOr(Schema.Unknown),
  fields: Schema.Array(DeployFieldChangeSchema),
  liveHash: Schema.NullOr(Schema.String),
});

export type DeployResourceChange = typeof DeployResourceChangeSchema.Type;

export const DeployPlanSummarySchema = Schema.Struct({
  create: Schema.Number,
  update: Schema.Number,
  delete: Schema.Number,
  noop: Schema.Number,
});

export type DeployPlanSummary = typeof DeployPlanSummarySchema.Type;

export const DeployPlanSchema = Schema.Struct({
  changes: Schema.Array(DeployResourceChangeSchema),
  summary: DeployPlanSummarySchema,
});

export type DeployPlan = typeof DeployPlanSchema.Type;

export const DeployAppliedChangeSchema = Schema.Struct({
  change: DeployResourceChangeSchema,
});

export const DeployAbortedChangeSchema = Schema.Struct({
  change: DeployResourceChangeSchema,
  reason: Schema.Literal("remote-changed"),
});

export const DeployApplyResultSchema = Schema.Struct({
  applied: Schema.Array(DeployAppliedChangeSchema),
  aborted: Schema.Array(DeployAbortedChangeSchema),
  skipped: Schema.Array(DeployResourceChangeSchema),
});

export type DeployApplyResult = typeof DeployApplyResultSchema.Type;

export const DeployPullResultSchema = Schema.Struct({
  pulled: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      key: Schema.String,
      path: Schema.String,
    }),
  ),
});

export type DeployPullResult = typeof DeployPullResultSchema.Type;

// ── Connection ────────────────────────────────────────────────────────────────

export const DeployConnectionSchema = Schema.Struct({
  id: Schema.String,
  consumer: Schema.String,
  /** Account label resolved from the token via the live `whoami`/list probe. */
  account: Schema.NullOr(Schema.String),
  env: Schema.String,
  baseUrl: Schema.NullOr(Schema.String),
  /** Entity kinds the connection manages (narrows the provider registry). */
  enabledKinds: Schema.Array(Schema.String),
  connected: Schema.Boolean,
});

export type DeployConnection = typeof DeployConnectionSchema.Type;

export const DeployConnectRequestSchema = Schema.Struct({
  consumer: Schema.String,
  /** Bearer token; stored server-side as a secret-ref, never echoed back. */
  token: Schema.String,
  baseUrl: Schema.optional(Schema.String),
  env: Schema.optional(Schema.String),
  enabledKinds: Schema.optional(Schema.Array(Schema.String)),
});

export type DeployConnectRequest = typeof DeployConnectRequestSchema.Type;

// ── Run model ─────────────────────────────────────────────────────────────────

export const DeployRunKindSchema = Schema.Literals(["pull", "plan", "apply", "destroy"]);

export type DeployRunKind = typeof DeployRunKindSchema.Type;

export const DeployRunStatusSchema = Schema.Literals(["running", "succeeded", "failed", "aborted"]);

export type DeployRunStatus = typeof DeployRunStatusSchema.Type;

export const DeployRunSchema = Schema.Struct({
  id: Schema.String,
  kind: DeployRunKindSchema,
  status: DeployRunStatusSchema,
  startedAt: Schema.String,
  finishedAt: Schema.optional(Schema.NullOr(Schema.String)),
  /** Plan summary, pull result, or apply result depending on `kind`. */
  summary: Schema.optional(Schema.NullOr(Schema.Unknown)),
  error: Schema.optional(Schema.NullOr(Schema.String)),
});

export type DeployRun = typeof DeployRunSchema.Type;

// ── Streamed events ───────────────────────────────────────────────────────────

export const DeployEventSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("run-started"), run: DeployRunSchema }),
  Schema.Struct({ type: Schema.Literal("run-finished"), run: DeployRunSchema }),
  Schema.Struct({
    type: Schema.Literal("sync-listed"),
    runId: Schema.String,
    total: Schema.Number,
  }),
  Schema.Struct({
    type: Schema.Literal("sync-hydrated"),
    runId: Schema.String,
    path: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("sync-failed"),
    runId: Schema.String,
    path: Schema.String,
    message: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("plan-ready"),
    runId: Schema.String,
    plan: DeployPlanSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("resource-applied"),
    runId: Schema.String,
    change: DeployResourceChangeSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("resource-aborted"),
    runId: Schema.String,
    change: DeployResourceChangeSchema,
    reason: Schema.Literal("remote-changed"),
  }),
  Schema.Struct({
    type: Schema.Literal("resource-skipped"),
    runId: Schema.String,
    change: DeployResourceChangeSchema,
  }),
]);

export type DeployEvent = typeof DeployEventSchema.Type;

// ── Request payloads ──────────────────────────────────────────────────────────

export const DeployApplyRequestSchema = Schema.Struct({
  plan: DeployPlanSchema,
  /** Permit deletes (slug in lock but absent from files). Default false. */
  allowDelete: Schema.optional(Schema.Boolean),
});

export type DeployApplyRequest = typeof DeployApplyRequestSchema.Type;

export const ListDeployRunsResponseSchema = Schema.Struct({
  runs: Schema.Array(DeployRunSchema),
});

export type ListDeployRunsResponse = typeof ListDeployRunsResponseSchema.Type;

// ── Errors ────────────────────────────────────────────────────────────────────

export const DeployRpcErrorSchema = Schema.Struct({
  message: Schema.String,
  code: Schema.Literals([
    "not-connected",
    "validation",
    "provider",
    "codec",
    "conflict",
    "storage",
    "unsupported",
  ]),
});

export type DeployRpcError = typeof DeployRpcErrorSchema.Type;

export type DeployErrorCode = DeployRpcError["code"];

// ── RPC group ─────────────────────────────────────────────────────────────────

export class SchemaIdeDeployRpcGroup extends RpcGroup.make(
  Rpc.make("DeployConnect", {
    payload: DeployConnectRequestSchema,
    success: DeployConnectionSchema,
    error: DeployRpcErrorSchema,
  }),
  Rpc.make("DeployGetConnection", {
    success: Schema.NullOr(DeployConnectionSchema),
    error: DeployRpcErrorSchema,
  }),
  Rpc.make("DeployPull", {
    success: DeployPullResultSchema,
    error: DeployRpcErrorSchema,
  }),
  Rpc.make("DeployPlan", {
    success: DeployPlanSchema,
    error: DeployRpcErrorSchema,
  }),
  Rpc.make("DeployApply", {
    payload: DeployApplyRequestSchema,
    success: DeployApplyResultSchema,
    error: DeployRpcErrorSchema,
  }),
  Rpc.make("DeployDestroy", {
    success: DeployApplyResultSchema,
    error: DeployRpcErrorSchema,
  }),
  Rpc.make("ListDeployRuns", {
    success: ListDeployRunsResponseSchema,
    error: DeployRpcErrorSchema,
  }),
  Rpc.make("WatchDeploy", {
    success: DeployEventSchema,
    error: DeployRpcErrorSchema,
    stream: true,
  }),
) {}

// ── Service interface ─────────────────────────────────────────────────────────

export interface SchemaIdeDeployService {
  readonly connect: (
    request: DeployConnectRequest,
  ) => Effect.Effect<DeployConnection, SchemaIdeDeployError>;
  readonly getConnection: Effect.Effect<DeployConnection | null, SchemaIdeDeployError>;
  readonly pull: Effect.Effect<DeployPullResult, SchemaIdeDeployError>;
  readonly plan: Effect.Effect<DeployPlan, SchemaIdeDeployError>;
  readonly apply: (
    request: DeployApplyRequest,
  ) => Effect.Effect<DeployApplyResult, SchemaIdeDeployError>;
  readonly destroy: Effect.Effect<DeployApplyResult, SchemaIdeDeployError>;
  readonly listRuns: Effect.Effect<ListDeployRunsResponse, SchemaIdeDeployError>;
  readonly watch: Stream.Stream<DeployEvent, SchemaIdeDeployError>;
}

export class SchemaIdeDeploy extends Context.Service<SchemaIdeDeploy, SchemaIdeDeployService>()(
  "schema-ide/SchemaIdeDeploy",
) {}

// ── Error type + mappers ────────────────────────────────────────────────────────

export class SchemaIdeDeployError extends Error {
  readonly _tag = "SchemaIdeDeployError" as const;

  constructor(
    message: string,
    readonly code: DeployErrorCode,
  ) {
    super(message);
    this.name = "SchemaIdeDeployError";
  }
}

export function isSchemaIdeDeployError(error: unknown): error is SchemaIdeDeployError {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    (error as { _tag?: unknown })._tag === "SchemaIdeDeployError"
  );
}

export function toDeployRpcError(error: unknown): DeployRpcError {
  if (isSchemaIdeDeployError(error)) {
    return { message: error.message, code: error.code };
  }
  return { message: error instanceof Error ? error.message : String(error), code: "storage" };
}

export function deployRpcErrorToError(error: DeployRpcError): SchemaIdeDeployError {
  return new SchemaIdeDeployError(error.message, error.code);
}
