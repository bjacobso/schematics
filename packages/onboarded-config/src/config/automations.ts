import { Schema } from "effect";
import {
  AutoDependencyDtoSchema,
  AutomationEdgeDtoSchema,
  AutomationNodeDtoSchema,
  TriggerEntitySchema,
  TriggerRerunBehaviorSchema,
  type AutomationDetailDto,
  type AutomationImportExportDto,
} from "../domain/automations";

/**
 * Config-file shape for an automation. Slug `id` + the node/edge graph (the
 * import/export shape); server-assigned fields (`auto_…`, version) dropped.
 * Nested form references inside action params remain `task_lineage_uid` for now
 * (deep ref resolution is a follow-up).
 */
export const OnboardedAutomationConfigSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  triggerEntity: TriggerEntitySchema,
  triggerRerunBehavior: TriggerRerunBehaviorSchema,
  isDependentOnCreate: Schema.Boolean,
  dependencies: Schema.Array(AutoDependencyDtoSchema),
  nodes: Schema.Array(AutomationNodeDtoSchema),
  edges: Schema.Array(AutomationEdgeDtoSchema),
});
export type OnboardedAutomationConfig = typeof OnboardedAutomationConfigSchema.Type;

export const automationConfigFromDto = (dto: AutomationDetailDto): OnboardedAutomationConfig => ({
  id: dto.id, // placeholder; engine pins the slug
  name: dto.name,
  description: dto.description ?? undefined,
  triggerEntity: dto.trigger_entity,
  triggerRerunBehavior: dto.trigger_rerun_behavior ?? "never",
  isDependentOnCreate: dto.is_dependent_on_create,
  dependencies: dto.dependencies,
  nodes: dto.nodes,
  edges: dto.edges,
});

export const automationImportDtoFromConfig = (
  config: OnboardedAutomationConfig,
): AutomationImportExportDto => ({
  name: config.name,
  description: config.description ?? null,
  trigger_rerun_behavior: config.triggerRerunBehavior,
  is_dependent_on_create: config.isDependentOnCreate,
  trigger_entity: config.triggerEntity,
  dependencies: config.dependencies,
  nodes: config.nodes,
  edges: config.edges,
});
