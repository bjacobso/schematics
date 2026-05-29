import { Workspace } from "@schema-ide/core";
import { type OnboardedAccountConfig } from "./account";
import {
  buildAttributeRegistry,
  validateAttributeCatalog,
  type OnboardedAttributeCatalog,
} from "./attributes";
import { validateAutomation, type OnboardedAutomationConfig } from "./automations";
import { OnboardedArtifactProject } from "./artifacts";
import { buildIdMap } from "./common";
import {
  buildPdfAnnotationRegistry,
  buildDocumentRegistry,
  buildPdfInspectRegistry,
  validateDocumentConfig,
  type DocumentFileEntry,
  type OnboardedDocumentConfig,
  type OnboardedPdfAnnotationDocument,
  type OnboardedPdfInspect,
} from "./documents";
import {
  validateForm,
  validateFormNamespace,
  type OnboardedFormConfig,
  type OnboardedFormSubscription,
} from "./forms";
import { type OnboardedImportManifest } from "./imports";
import { validatePdfMapping, type OnboardedPdfMappingConfig } from "./pdf-mappings";
import { validatePolicy, type OnboardedPolicyConfig } from "./policies";
import { validateOnboardedRelations } from "./relations";

export type AccountWorkspaceValue = {
  readonly account: OnboardedAccountConfig | null;
  readonly attributes: OnboardedAttributeCatalog | null;
  readonly forms: readonly OnboardedFormConfig[];
  readonly formSubscriptions: readonly OnboardedFormSubscription[];
  readonly documents: readonly DocumentFileEntry<OnboardedDocumentConfig>[];
  readonly pdfInspections: readonly DocumentFileEntry<OnboardedPdfInspect>[];
  readonly pdfAnnotations: readonly DocumentFileEntry<OnboardedPdfAnnotationDocument>[];
  readonly pdfMappings: readonly OnboardedPdfMappingConfig[];
  readonly policies: readonly OnboardedPolicyConfig[];
  readonly automations: readonly OnboardedAutomationConfig[];
  readonly imports: readonly OnboardedImportManifest[];
};

const onboardedRouteAnnotations = {
  forms: { identifier: "OnboardedForms", description: "Local account forms" },
  formSubscriptions: {
    identifier: "OnboardedFormSubscriptions",
    description: "Compliance library form subscriptions",
  },
  documents: {
    identifier: "OnboardedDocuments",
    description: "Account document registrations",
  },
  pdfInspections: {
    identifier: "OnboardedPdfInspections",
    description: "Generated PDF inspection metadata",
  },
  pdfAnnotations: {
    identifier: "OnboardedPdfAnnotations",
    description: "Generated PDF annotation metadata",
  },
  pdfMappings: {
    identifier: "OnboardedPdfMappings",
    description: "Mappings between account forms and PDF documents",
  },
  policies: {
    identifier: "OnboardedPolicies",
    description: "Account policy definitions",
  },
  automations: {
    identifier: "OnboardedAutomations",
    description: "Account automation definitions",
  },
  imports: { identifier: "OnboardedImports", description: "Source manifests" },
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
      const attributes = buildAttributeRegistry(workspace.attributes);
      const forms = buildIdMap(workspace.forms, "forms", issue);
      const formSubscriptions = buildIdMap(workspace.formSubscriptions, "formSubscriptions", issue);
      const allForms = new Map<string, unknown>();
      for (const [id, form] of forms) allForms.set(id, form);
      for (const [id, subscription] of formSubscriptions) allForms.set(id, subscription);
      const documents = buildDocumentRegistry(workspace.documents, issue);
      const pdfInspections = buildPdfInspectRegistry(workspace.pdfInspections);
      const pdfAnnotations = buildPdfAnnotationRegistry(workspace.pdfAnnotations);
      buildIdMap(workspace.pdfMappings, "pdfMappings", issue);
      const policies = buildIdMap(workspace.policies, "policies", issue);

      validateAttributeCatalog(workspace.attributes, issue);
      validateFormNamespace(forms, formSubscriptions, issue);
      validateOnboardedRelations(workspace, documents, pdfInspections, pdfAnnotations, issue);

      for (const form of workspace.forms) {
        validateForm(form, attributes, issue);
      }

      for (const policy of workspace.policies) {
        validatePolicy(policy, allForms, attributes, issue);
      }

      for (const document of workspace.documents) {
        validateDocumentConfig(document, context.files, pdfInspections, pdfAnnotations, issue);
      }

      for (const mapping of workspace.pdfMappings) {
        validatePdfMapping(mapping, documents, pdfInspections, issue);
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
