import { Schema } from "effect";
import type { AttributeRegistry } from "./attributes";
import type { WorkspaceIssue } from "./common";
import { OnboardedRuleSchema } from "./rules";
import { validateRuleFacts } from "./validation";

export const OnboardedPolicyConfigSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["draft", "active", "deprecated"]),
  appliesTo: Schema.Literals(["employee", "placement", "client", "job"]),
  description: Schema.optional(Schema.String),
  when: OnboardedRuleSchema,
  requires: Schema.Struct({
    forms: Schema.Array(
      Schema.Struct({
        form: Schema.String,
        required: Schema.optional(Schema.Boolean),
        when: Schema.optional(OnboardedRuleSchema),
      }),
    ),
  }),
});
export type OnboardedPolicyConfig = typeof OnboardedPolicyConfigSchema.Type;

export function validatePolicy(
  policy: OnboardedPolicyConfig,
  forms: ReadonlyMap<string, unknown>,
  attributes: AttributeRegistry,
  issue: WorkspaceIssue,
) {
  for (const requiredForm of policy.requires.forms) {
    if (!forms.has(requiredForm.form)) {
      issue.at(`policies.${policy.id}.requires.forms`, `Unknown form: ${requiredForm.form}`);
    }
    if (requiredForm.when) {
      validateRuleFacts(
        requiredForm.when,
        `policies.${policy.id}.requires.forms`,
        attributes,
        forms,
        issue,
      );
    }
  }

  validateRuleFacts(policy.when, `policies.${policy.id}.when`, attributes, forms, issue);
}
