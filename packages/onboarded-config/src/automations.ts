import { Schema } from "effect";
import type { AttributeRegistry } from "./attributes";
import { EntitySchema, findDuplicates, type WorkspaceIssue } from "./common";
import { OnboardedRuleSchema } from "./rules";
import { isKnownPath, validateRuleFacts } from "./validation";

const AutomationTriggerSchema = Schema.Struct({
  entity: EntitySchema,
  on: Schema.Literals(["created", "updated"]),
  properties: Schema.optional(Schema.Array(Schema.String)),
});

const AutomationStepSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.Literals([
    "wait",
    "send_email",
    "assign_task",
    "create_task",
    "set_task_expiration",
  ]),
  until: Schema.optional(
    Schema.Struct({
      fact: Schema.String,
      offset: Schema.Struct({
        amount: Schema.Number,
        unit: Schema.Literals(["minute", "hour", "day"]),
      }),
    }),
  ),
  to: Schema.optional(Schema.String),
  template: Schema.optional(Schema.String),
  form: Schema.optional(Schema.String),
  policy: Schema.optional(Schema.String),
});
export type OnboardedAutomationStep = typeof AutomationStepSchema.Type;

export const OnboardedAutomationConfigSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["draft", "active", "deprecated"]),
  trigger: AutomationTriggerSchema,
  when: Schema.optional(OnboardedRuleSchema),
  steps: Schema.Array(AutomationStepSchema),
});
export type OnboardedAutomationConfig = typeof OnboardedAutomationConfigSchema.Type;

const triggerPropertiesByEntity: Record<string, readonly string[]> = {
  task: ["status", "due_at", "expired_at", "next_action"],
  placement: ["status", "progress"],
};

export function validateAutomation(
  automation: OnboardedAutomationConfig,
  forms: ReadonlyMap<string, unknown>,
  policies: ReadonlyMap<string, unknown>,
  attributes: AttributeRegistry,
  issue: WorkspaceIssue,
) {
  const allowedProperties = triggerPropertiesByEntity[automation.trigger.entity] ?? [];
  for (const property of automation.trigger.properties ?? []) {
    if (!allowedProperties.includes(property)) {
      issue.at(
        `automations.${automation.id}.trigger.properties`,
        `Unsupported trigger property for ${automation.trigger.entity}: ${property}`,
      );
    }
  }

  if (automation.when) {
    validateRuleFacts(
      automation.when,
      `automations.${automation.id}.when`,
      attributes,
      forms,
      issue,
    );
  }

  for (const duplicateStepId of findDuplicates(automation.steps.map((step) => step.id))) {
    issue.at(
      `automations.${automation.id}.steps`,
      `Duplicate automation step id: ${duplicateStepId}`,
    );
  }

  for (const step of automation.steps) {
    if (step.until && !isKnownPath(step.until.fact, attributes, forms)) {
      issue.at(
        `automations.${automation.id}.steps`,
        `Unknown wait step fact path: ${step.until.fact}`,
      );
    }
    if (step.form && !forms.has(step.form)) {
      issue.at(`automations.${automation.id}.steps`, `Unknown automation step form: ${step.form}`);
    }
    if (step.policy && !policies.has(step.policy)) {
      issue.at(
        `automations.${automation.id}.steps`,
        `Unknown automation step policy: ${step.policy}`,
      );
    }
  }
}
