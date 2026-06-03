import { Schema } from "effect";
import { Relation, validateRelations, type RelationDiagnostic } from "@schematics/algebra";
import type { WorkspaceIssue } from "./common";
import type {
  OnboardedCustomPropertyConfig,
  OnboardedFormConfig,
  OnboardedPolicyConfig,
} from "./config";

/**
 * Relation graph over the domain entities, for the IDE's relation/reference
 * views and unresolved-ref diagnostics:
 *
 * - a custom property is defined by its `path`,
 * - a form references custom properties via `attributePaths`,
 * - a policy references forms via `forms` (slugs).
 */
const CustomPropertyRelationSchema = Schema.Struct({
  path: Relation.id("CustomProperty"),
});

const FormRelationSchema = Schema.Struct({
  id: Relation.id("Form", { display: "name" }),
  attributePaths: Schema.Array(Relation.ref("CustomProperty")),
});

const PolicyRelationSchema = Schema.Struct({
  id: Relation.id("Policy", { display: "name" }),
  forms: Schema.Array(Relation.ref("Form")),
});

export const OnboardedRelationProjectSchema = Schema.Struct({
  customProperties: Schema.Array(CustomPropertyRelationSchema),
  forms: Schema.Array(FormRelationSchema),
  policies: Schema.Array(PolicyRelationSchema),
});
export type OnboardedRelationWorkspace = typeof OnboardedRelationProjectSchema.Type;

export interface OnboardedRelationInput {
  readonly customProperties: readonly OnboardedCustomPropertyConfig[];
  readonly forms: readonly OnboardedFormConfig[];
  readonly policies: readonly OnboardedPolicyConfig[];
}

export function createOnboardedRelationWorkspace(
  workspace: OnboardedRelationInput,
): OnboardedRelationWorkspace {
  return {
    customProperties: workspace.customProperties.map((property) => ({ path: property.path })),
    forms: workspace.forms.map((form) => ({
      id: form.id,
      name: form.name,
      attributePaths: form.attributePaths ?? [],
    })),
    policies: workspace.policies.map((policy) => ({
      id: policy.id,
      name: policy.name,
      forms: policy.forms ?? [],
    })),
  };
}

export function validateOnboardedRelations(
  workspace: OnboardedRelationInput,
  issue: WorkspaceIssue,
): void {
  const value = createOnboardedRelationWorkspace(workspace);
  for (const diagnostic of validateRelations(OnboardedRelationProjectSchema, value)) {
    if (diagnostic.code !== "unresolved-ref") continue;
    issue.at(issuePath(diagnostic), messageFor(diagnostic));
  }
}

function messageFor(diagnostic: RelationDiagnostic): string {
  const relation = diagnostic.relation;
  if (!("target" in relation)) return diagnostic.message;
  switch (relation.target) {
    case "Form":
      return `Unknown form: ${relation.id}`;
    case "CustomProperty":
      return `Unknown attribute path: ${relation.id}`;
    default:
      return diagnostic.message;
  }
}

function issuePath(diagnostic: RelationDiagnostic): string {
  return diagnostic.path.length > 0 ? diagnostic.path.join(".") : "relations";
}
