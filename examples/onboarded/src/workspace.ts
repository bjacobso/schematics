import {
  Project,
  type SchematicsDiagnostic,
  type SourceFile,
  type ProjectValidationIssue,
} from "@schematics/core";
import { validateRelations, type RelationDiagnostic } from "@schematics/algebra";
import { Schema } from "effect";
import { OnboardedArtifactProject } from "./artifacts";
import type {
  OnboardedAccountConfig,
  OnboardedAutomationConfig,
  OnboardedCustomPropertyConfig,
  OnboardedFormConfig,
  OnboardedPolicyConfig,
} from "./config";
import {
  ACCOUNT_KIND,
  AUTOMATION_KIND,
  CUSTOM_PROPERTY_KIND,
  FORM_KIND,
  OnboardedAccountConfigSchema,
  OnboardedAutomationConfigSchema,
  OnboardedCustomPropertyConfigSchema,
  OnboardedFormConfigSchema,
  OnboardedPolicyConfigSchema,
  POLICY_KIND,
} from "./config";
import { buildAttributePathSet, validateRuleFacts } from "./validation";

export type AccountWorkspaceValue = {
  readonly account: OnboardedAccountConfig | null;
  readonly customProperties: readonly OnboardedCustomPropertyConfig[];
  readonly forms: readonly OnboardedFormConfig[];
  readonly policies: readonly OnboardedPolicyConfig[];
  readonly automations: readonly OnboardedAutomationConfig[];
};

const onboardedRouteAnnotations = {
  customProperties: {
    identifier: "OnboardedCustomProperties",
    description: "Account custom properties (attributes)",
  },
  forms: { identifier: "OnboardedForms", description: "Account forms" },
  policies: { identifier: "OnboardedPolicies", description: "Account policy definitions" },
  automations: {
    identifier: "OnboardedAutomations",
    description: "Account automation definitions",
  },
} as const satisfies Record<string, { readonly identifier: string; readonly description: string }>;

export const OnboardedAccountProjectBaseSchema = Project.fromArtifactProject(
  OnboardedArtifactProject,
  {
    annotations: (route) =>
      onboardedRouteAnnotations[route.id as keyof typeof onboardedRouteAnnotations],
  },
) as any;

export const OnboardedAccountRelationSchema = Schema.Struct({
  account: Schema.NullOr(OnboardedAccountConfigSchema),
  customProperties: Schema.Array(OnboardedCustomPropertyConfigSchema),
  forms: Schema.Array(OnboardedFormConfigSchema),
  policies: Schema.Array(OnboardedPolicyConfigSchema),
  automations: Schema.Array(OnboardedAutomationConfigSchema),
});

export const OnboardedAccountProjectSchema = OnboardedAccountProjectBaseSchema.pipe(
  Project.validate<AccountWorkspaceValue>(
    "onboarded account workspace references resolve",
    (workspace, issue, context) => {
      for (const diagnostic of validateOnboardedAccountWorkspaceValue(workspace, context.files)) {
        issue.at(diagnostic.documentPath ?? "onboarded", diagnostic.message, diagnostic.path);
      }
    },
  ),
);

export function validateOnboardedAccountWorkspaceValue(
  workspace: AccountWorkspaceValue,
  _files: readonly SourceFile[],
): readonly SchematicsDiagnostic[] {
  const diagnostics: SchematicsDiagnostic[] = [];
  const issue = onboardedIssue(diagnostics);

  const attributePaths = buildAttributePathSet(workspace.customProperties);
  const formSlugs = new Set(workspace.forms.map((form) => form.id));

  // Cross-entity references and duplicate ids come from the annotated config schemas.
  validateOnboardedSchemaRelations(workspace, issue);

  // rule-fact validation (relations can't reach into rules)
  for (const policy of workspace.policies) {
    validateRuleFacts(policy.rules, `policies.${policy.id}`, attributePaths, formSlugs, issue);
  }
  for (const automation of workspace.automations) {
    for (const node of automation.nodes) {
      if (node.type === "condition") {
        validateRuleFacts(
          node.rules,
          `automations.${automation.id}`,
          attributePaths,
          formSlugs,
          issue,
        );
      }
    }
  }

  return diagnostics;
}

function validateOnboardedSchemaRelations(
  workspace: AccountWorkspaceValue,
  issue: ProjectValidationIssue,
): void {
  for (const diagnostic of validateRelations(OnboardedAccountRelationSchema, workspace)) {
    issue.at(
      issueDocumentPath(diagnostic),
      messageForRelationDiagnostic(diagnostic),
      issuePath(diagnostic),
    );
  }
}

function messageForRelationDiagnostic(diagnostic: RelationDiagnostic): string {
  const relation = diagnostic.relation;
  if (diagnostic.code === "unresolved-ref" && "target" in relation) {
    switch (relation.target) {
      case FORM_KIND:
        return `Unknown form: ${relation.id}`;
      case CUSTOM_PROPERTY_KIND:
        return `Unknown attribute path: ${relation.id}`;
      default:
        return diagnostic.message;
    }
  }

  if (diagnostic.code === "duplicate-id" && "type" in relation) {
    switch (relation.type) {
      case FORM_KIND:
        return `Duplicate forms id: ${relation.id}`;
      case POLICY_KIND:
        return `Duplicate policies id: ${relation.id}`;
      case AUTOMATION_KIND:
        return `Duplicate automations id: ${relation.id}`;
      case CUSTOM_PROPERTY_KIND:
        return `Duplicate custom property path: ${relation.id}`;
      case ACCOUNT_KIND:
        return `Duplicate account id: ${relation.id}`;
      default:
        return diagnostic.message;
    }
  }

  return diagnostic.message;
}

function issueDocumentPath(diagnostic: RelationDiagnostic): string {
  const relation = diagnostic.relation;
  if ("id" in relation) {
    switch ("target" in relation ? relation.target : relation.type) {
      case FORM_KIND:
        return `forms.${relation.id}`;
      case POLICY_KIND:
        return `policies.${relation.id}`;
      case AUTOMATION_KIND:
        return `automations.${relation.id}`;
      case CUSTOM_PROPERTY_KIND:
        return `customProperties.${relation.id}`;
      case ACCOUNT_KIND:
        return `account.${relation.id}`;
      default:
        break;
    }
  }
  return diagnostic.path.length > 0 ? diagnostic.path.join(".") : "relations";
}

function issuePath(diagnostic: RelationDiagnostic): string | null {
  return diagnostic.path.length > 0 ? diagnostic.path.join(".") : null;
}

function onboardedIssue(diagnostics: SchematicsDiagnostic[]): ProjectValidationIssue {
  return {
    at: (documentPath, message, path = null) => {
      diagnostics.push({
        path,
        documentPath,
        severity: "error",
        source: "cross-file",
        message,
      });
    },
  };
}
