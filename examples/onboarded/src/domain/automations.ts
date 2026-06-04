import { Relation } from "@schematics/algebra";
import { Schema } from "effect";
import { RuleDtoSchema } from "./shared";
import { FORM_KIND } from "../kinds";

/**
 * Mirror of the domain Automation resource (internal `/automations`). Id prefix
 * `auto_`. The config-friendly shape is `AutomationImportExport` (name + trigger
 * metadata + node/edge graph, no server-assigned fields).
 */

export const TriggerEntitySchema = Schema.Literals(["task", "placement"] as const);
export const TriggerRerunBehaviorSchema = Schema.Literals([
  "never",
  "always",
  "always_run",
  "on_change",
] as const);
export const AutomationStatusSchema = Schema.Literals([
  "draft",
  "published",
  "deprecated",
] as const);

export const AutoDependencyDtoSchema = Schema.Struct({
  entity: TriggerEntitySchema,
  property: Schema.Literals(["status", "expired_at", "due_at", "next_action", "progress"] as const),
});

const NodePositionSchema = Schema.Struct({ x: Schema.Number, y: Schema.Number });

// ── Action params (discriminated on `params_type`) ──────────────────────────────
const SendEmailParams = Schema.Struct({
  params_type: Schema.Literal("send_email"),
  sendgrid_template_id: Schema.optional(Schema.String),
  dynamic_template_fields: Schema.optional(
    Schema.Array(Schema.Struct({ name: Schema.String, template: Schema.String })),
  ),
  recipient_type: Schema.optional(Schema.Literals(["employee", "custom"] as const)),
  recipient_email: Schema.optional(Schema.String),
});
const HttpRequestParams = Schema.Struct({
  params_type: Schema.Literal("http_request"),
  url: Schema.String,
  method: Schema.Literals(["GET", "POST", "PUT", "DELETE", "PATCH"] as const),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  url_parameters: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  body: Schema.optional(Schema.String),
});
const AssignTaskParams = Schema.Struct({
  params_type: Schema.Literal("assign_task"),
  assignment_type: Schema.optional(Schema.String),
  user_id: Schema.optional(Schema.String),
  group_id: Schema.optional(Schema.String),
});
const CreateTaskParams = Schema.Struct({
  params_type: Schema.Literal("create_task"),
  task_lineage_uid: Relation.ref(FORM_KIND),
});
const CreateSuggestedTaskParams = Schema.Struct({
  params_type: Schema.Literal("create_suggested_task"),
  task_lineage_uid: Relation.ref(FORM_KIND),
  also_create_task: Schema.optional(Schema.Boolean),
});
const SetTaskExpirationParams = Schema.Struct({
  params_type: Schema.Literal("set_task_expiration"),
  task_lineage_uid: Schema.optional(Relation.ref(FORM_KIND)),
  expiration_strategy: Schema.Literals(["specific_time", "relative_time", "form_field"] as const),
  expiration_date: Schema.optional(Schema.String),
  expire_after_days: Schema.optional(Schema.Number),
  form_field_path: Schema.optional(Schema.String),
});
export const AutomationActionParamsSchema = Schema.Union([
  SendEmailParams,
  HttpRequestParams,
  AssignTaskParams,
  CreateTaskParams,
  CreateSuggestedTaskParams,
  SetTaskExpirationParams,
]);

// ── Nodes (discriminated on `type`) ─────────────────────────────────────────────
const StartNode = Schema.Struct({
  type: Schema.Literal("start"),
  id: Schema.String,
  position: NodePositionSchema,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  trigger_rerun_behavior: TriggerRerunBehaviorSchema,
  is_dependent_on_create: Schema.Boolean,
  dependencies: Schema.Array(AutoDependencyDtoSchema),
});
const TimeNode = Schema.Struct({
  type: Schema.Literal("time"),
  id: Schema.String,
  position: NodePositionSchema,
  name: Schema.String,
  baseline_type: Schema.Literals(["now", "task_expired", "task_due"] as const),
  baseline_transform_seconds: Schema.Number,
  duration: Schema.Number,
  transform_time_unit: Schema.Literals(["day", "hour", "minute"] as const),
  recalculate_facts: Schema.NullOr(Schema.Boolean),
});
const ConditionNode = Schema.Struct({
  type: Schema.Literal("condition"),
  id: Schema.String,
  position: NodePositionSchema,
  name: Schema.String,
  rules: RuleDtoSchema,
});
const ActionNode = Schema.Struct({
  type: Schema.Literal("action"),
  id: Schema.String,
  position: NodePositionSchema,
  name: Schema.String,
  action_type: Schema.String,
  action_params: Schema.optional(Schema.NullOr(AutomationActionParamsSchema)),
});
export const AutomationNodeDtoSchema = Schema.Union([
  StartNode,
  TimeNode,
  ConditionNode,
  ActionNode,
]);

export const AutomationEdgeDtoSchema = Schema.Struct({
  id: Schema.String,
  source: Schema.String,
  target: Schema.String,
  source_handle: Schema.optional(Schema.String),
  target_handle: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
  edge_type: Schema.optional(Schema.Literals(["default", "yes", "no"] as const)),
});

/** Summary resource from `/automations` list. */
export const AutomationDtoSchema = Schema.Struct({
  id: Schema.String, // auto_
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  trigger_rerun_behavior: TriggerRerunBehaviorSchema,
  is_dependent_on_create: Schema.Boolean,
  trigger_entity: TriggerEntitySchema,
  dependencies: Schema.Array(AutoDependencyDtoSchema),
  status: AutomationStatusSchema,
  created_at: Schema.String,
  auto_version_id: Schema.Number,
});
export type AutomationDto = typeof AutomationDtoSchema.Type;

/** Full detail with the node/edge graph (from `/automations/:id`). */
export const AutomationDetailDtoSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  trigger_rerun_behavior: Schema.NullOr(TriggerRerunBehaviorSchema),
  is_dependent_on_create: Schema.Boolean,
  trigger_entity: TriggerEntitySchema,
  dependencies: Schema.Array(AutoDependencyDtoSchema),
  status: AutomationStatusSchema,
  version_number: Schema.Number,
  nodes: Schema.Array(AutomationNodeDtoSchema),
  edges: Schema.Array(AutomationEdgeDtoSchema),
});
export type AutomationDetailDto = typeof AutomationDetailDtoSchema.Type;

/** The config-friendly export/import shape (no server-assigned fields). */
export const AutomationImportExportDtoSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  trigger_rerun_behavior: Schema.NullOr(TriggerRerunBehaviorSchema),
  is_dependent_on_create: Schema.Boolean,
  trigger_entity: TriggerEntitySchema,
  dependencies: Schema.Array(AutoDependencyDtoSchema),
  nodes: Schema.Array(AutomationNodeDtoSchema),
  edges: Schema.Array(AutomationEdgeDtoSchema),
});
export type AutomationImportExportDto = typeof AutomationImportExportDtoSchema.Type;
