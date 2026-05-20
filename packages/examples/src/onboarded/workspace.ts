import { Workspace } from "@schema-ide/core";
import { OnboardedAccountConfigSchema, type OnboardedAccountConfig } from "./account";
import {
  OnboardedAttributeCatalogSchema,
  buildAttributeRegistry,
  validateAttributeCatalog,
  type OnboardedAttributeCatalog,
} from "./attributes";
import {
  OnboardedAutomationConfigSchema,
  validateAutomation,
  type OnboardedAutomationConfig,
} from "./automations";
import { buildIdMap } from "./common";
import {
  OnboardedFormConfigSchema,
  OnboardedFormSubscriptionSchema,
  validateForm,
  validateFormNamespace,
  type OnboardedFormConfig,
  type OnboardedFormSubscription,
} from "./forms";
import { OnboardedImportManifestSchema, type OnboardedImportManifest } from "./imports";
import {
  OnboardedPolicyConfigSchema,
  validatePolicy,
  type OnboardedPolicyConfig,
} from "./policies";

type AccountWorkspaceValue = {
  readonly account: OnboardedAccountConfig | null;
  readonly attributes: OnboardedAttributeCatalog | null;
  readonly forms: readonly OnboardedFormConfig[];
  readonly formSubscriptions: readonly OnboardedFormSubscription[];
  readonly policies: readonly OnboardedPolicyConfig[];
  readonly automations: readonly OnboardedAutomationConfig[];
  readonly imports: readonly OnboardedImportManifest[];
};

export const OnboardedAccountWorkspaceSchema = Workspace.Struct({
  account: Workspace.file("account.yaml", OnboardedAccountConfigSchema),
  attributes: Workspace.file("attributes.yaml", OnboardedAttributeCatalogSchema),
  forms: Workspace.files("forms/*.yaml", OnboardedFormConfigSchema).pipe(
    Workspace.annotations({ identifier: "OnboardedForms", description: "Local account forms" }),
    Workspace.values(),
  ),
  formSubscriptions: Workspace.files("forms/library/*.yaml", OnboardedFormSubscriptionSchema, {
    optional: true,
  }).pipe(
    Workspace.annotations({
      identifier: "OnboardedFormSubscriptions",
      description: "Compliance library form subscriptions",
    }),
    Workspace.values(),
  ),
  policies: Workspace.files("policies/*.yaml", OnboardedPolicyConfigSchema).pipe(
    Workspace.annotations({
      identifier: "OnboardedPolicies",
      description: "Account policy definitions",
    }),
    Workspace.values(),
  ),
  automations: Workspace.files("automations/*.yaml", OnboardedAutomationConfigSchema, {
    optional: true,
  }).pipe(
    Workspace.annotations({
      identifier: "OnboardedAutomations",
      description: "Account automation definitions",
    }),
    Workspace.values(),
  ),
  imports: Workspace.files("imports/*.yaml", OnboardedImportManifestSchema, {
    optional: true,
  }).pipe(
    Workspace.annotations({ identifier: "OnboardedImports", description: "Source manifests" }),
    Workspace.values(),
  ),
}).pipe(
  Workspace.validate<AccountWorkspaceValue>(
    "onboarded account workspace references resolve",
    (workspace, issue) => {
      const attributes = buildAttributeRegistry(workspace.attributes);
      const forms = buildIdMap(workspace.forms, "forms", issue);
      const formSubscriptions = buildIdMap(workspace.formSubscriptions, "formSubscriptions", issue);
      const allForms = new Map<string, unknown>();
      for (const [id, form] of forms) allForms.set(id, form);
      for (const [id, subscription] of formSubscriptions) allForms.set(id, subscription);
      const policies = buildIdMap(workspace.policies, "policies", issue);

      validateAttributeCatalog(workspace.attributes, issue);
      validateFormNamespace(forms, formSubscriptions, issue);

      for (const form of workspace.forms) {
        validateForm(form, attributes, issue);
      }

      for (const policy of workspace.policies) {
        validatePolicy(policy, allForms, attributes, issue);
      }

      for (const automation of workspace.automations) {
        validateAutomation(automation, allForms, policies, attributes, issue);
      }

      for (const manifest of workspace.imports) {
        for (const form of manifest.forms ?? []) {
          if (!forms.has(form.workspaceForm)) {
            issue.at(
              `imports.${manifest.source}.forms`,
              `Unknown imported workspace form: ${form.workspaceForm}`,
            );
          }
        }
      }
    },
  ),
);
