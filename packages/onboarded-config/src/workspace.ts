import {
  Workspace,
  type SchemaIdeDiagnostic,
  type SourceFile,
  type WorkspaceValidationIssue,
} from "@schema-ide/core";
import { OnboardedArtifactProject } from "./artifacts";
import { buildIdMap } from "./common";
import type {
  OnboardedAccountConfig,
  OnboardedAutomationConfig,
  OnboardedCustomPropertyConfig,
  OnboardedFormConfig,
  OnboardedPolicyConfig,
} from "./config";
import { validateOnboardedRelations } from "./relations";
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
  automations: { identifier: "OnboardedAutomations", description: "Account automation definitions" },
} as const satisfies Record<string, { readonly identifier: string; readonly description: string }>;

export const OnboardedAccountWorkspaceBaseSchema = Workspace.fromArtifactProject(
  OnboardedArtifactProject,
  {
    annotations: (route) =>
      onboardedRouteAnnotations[route.id as keyof typeof onboardedRouteAnnotations],
  },
) as any;

export const OnboardedAccountWorkspaceSchema = OnboardedAccountWorkspaceBaseSchema.pipe(
  Workspace.validate<AccountWorkspaceValue>(
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
): readonly SchemaIdeDiagnostic[] {
  const diagnostics: SchemaIdeDiagnostic[] = [];
  const issue = onboardedIssue(diagnostics);

  // duplicate detection
  buildIdMap(workspace.forms, "forms", issue);
  buildIdMap(workspace.policies, "policies", issue);
  buildIdMap(workspace.automations, "automations", issue);
  const seenPaths = new Set<string>();
  for (const property of workspace.customProperties) {
    if (seenPaths.has(property.path)) {
      issue.at(`customProperties.${property.path}`, `Duplicate custom property path: ${property.path}`);
    }
    seenPaths.add(property.path);
  }

  const attributePaths = buildAttributePathSet(workspace.customProperties);
  const formSlugs = new Set(workspace.forms.map((form) => form.id));

  // cross-entity reference resolution (form → attribute paths, policy → forms)
  validateOnboardedRelations(workspace, issue);

  // rule-fact validation (relations can't reach into rules)
  for (const policy of workspace.policies) {
    validateRuleFacts(policy.rules, `policies.${policy.id}`, attributePaths, formSlugs, issue);
  }
  for (const automation of workspace.automations) {
    for (const node of automation.nodes) {
      if (node.type === "condition") {
        validateRuleFacts(node.rules, `automations.${automation.id}`, attributePaths, formSlugs, issue);
      }
    }
  }

  return diagnostics;
}

function onboardedIssue(diagnostics: SchemaIdeDiagnostic[]): WorkspaceValidationIssue {
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
