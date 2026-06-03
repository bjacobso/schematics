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
import { FORM_KIND, type RefResolver } from "./refs";

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

type AutomationNode = OnboardedAutomationConfig["nodes"][number];

/** Rewrite `task_lineage_uid` form references in action nodes via `map` (slug↔uid). */
function remapFormRefs(
  nodes: readonly AutomationNode[],
  map: (value: string) => string | null,
): readonly AutomationNode[] {
  return nodes.map((node) => {
    if (node.type !== "action" || !node.action_params) return node;
    const params = node.action_params as { task_lineage_uid?: unknown };
    if (typeof params.task_lineage_uid !== "string") return node;
    const mapped = map(params.task_lineage_uid);
    if (mapped === null || mapped === params.task_lineage_uid) return node;
    return { ...node, action_params: { ...params, task_lineage_uid: mapped } } as AutomationNode;
  });
}

/** Form slugs referenced by an automation's action params (for dependency ordering). */
export function automationFormRefSlugs(config: OnboardedAutomationConfig): readonly string[] {
  const slugs: string[] = [];
  for (const node of config.nodes) {
    if (node.type !== "action" || !node.action_params) continue;
    const value = (node.action_params as { task_lineage_uid?: unknown }).task_lineage_uid;
    if (typeof value === "string") slugs.push(value);
  }
  return [...new Set(slugs)];
}

export const automationConfigFromDto = (
  dto: AutomationDetailDto,
  resolve: RefResolver,
): OnboardedAutomationConfig => ({
  id: dto.id, // placeholder; engine pins the slug
  name: dto.name,
  description: dto.description ?? undefined,
  triggerEntity: dto.trigger_entity,
  triggerRerunBehavior: dto.trigger_rerun_behavior ?? "never",
  isDependentOnCreate: dto.is_dependent_on_create,
  dependencies: dto.dependencies,
  nodes: remapFormRefs(dto.nodes, (uid) => resolve.toKey(FORM_KIND, uid)),
  edges: dto.edges,
});

export const automationImportDtoFromConfig = (
  config: OnboardedAutomationConfig,
  resolve: RefResolver,
): AutomationImportExportDto => ({
  name: config.name,
  description: config.description ?? null,
  trigger_rerun_behavior: config.triggerRerunBehavior,
  is_dependent_on_create: config.isDependentOnCreate,
  trigger_entity: config.triggerEntity,
  dependencies: config.dependencies,
  nodes: remapFormRefs(config.nodes, (slug) => resolve.toRemoteId(FORM_KIND, slug)),
  edges: config.edges,
});
