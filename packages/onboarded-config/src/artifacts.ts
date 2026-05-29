import {
  decodeYamlEither,
  SchemaIdeWorkspaceFileArtifact,
  stringifyDocument,
} from "@schema-ide/core";
import {
  ArtifactProject,
  type AnyArtifactType,
  type ArtifactProjectConfig,
  type ArtifactProjectConfigArtifact,
  type ArtifactProjectDeclaration,
} from "@schema-ide/artifacts";
import { Result, Schema, SchemaIssue } from "effect";
import { OnboardedAccountConfigSchema } from "./account";
import { OnboardedAttributeCatalogSchema } from "./attributes";
import { OnboardedAutomationConfigSchema } from "./automations";
import {
  OnboardedDocumentConfigSchema,
  OnboardedPdfAnnotationDocumentSchema,
  OnboardedPdfInspectSchema,
} from "./documents";
import { OnboardedFormConfigSchema, OnboardedFormSubscriptionSchema } from "./forms";
import { OnboardedImportManifestSchema } from "./imports";
import { OnboardedPdfMappingConfigSchema } from "./pdf-mappings";
import { OnboardedPolicyConfigSchema } from "./policies";

export const OnboardedArtifactProjectRouteSchema = Schema.Struct({
  id: Schema.String,
  pattern: Schema.String,
  artifact: Schema.String,
  format: Schema.Literals(["json", "yaml"] as const),
  mode: Schema.optional(Schema.Literals(["file", "files", "values"] as const)),
  optional: Schema.optional(Schema.Boolean),
  description: Schema.optional(Schema.String),
});

export const OnboardedArtifactProjectConfigSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  defaultFormat: Schema.Literals(["json", "yaml"] as const),
  include: Schema.Array(Schema.String),
  files: Schema.Array(OnboardedArtifactProjectRouteSchema),
  algebra: Schema.Struct({
    relationSchema: Schema.String,
    views: Schema.Array(Schema.String),
  }),
});

export type OnboardedArtifactProjectRoute = typeof OnboardedArtifactProjectRouteSchema.Type;
export type OnboardedArtifactProjectConfig = typeof OnboardedArtifactProjectConfigSchema.Type;

export const OnboardedArtifactProjectConfigDefinition = {
  id: "onboarded-account-yaml",
  name: "Onboarded Account Artifact Project",
  defaultFormat: "yaml",
  include: ["**/*.yaml", "**/*.pdf", "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.webp"],
  files: [
    {
      id: "account",
      pattern: "account.yaml",
      artifact: "OnboardedAccountConfig",
      format: "yaml",
      mode: "file",
      description: "Account-level settings and metadata.",
    },
    {
      id: "attributes",
      pattern: "attributes.yaml",
      artifact: "OnboardedAttributeCatalog",
      format: "yaml",
      mode: "file",
      description: "Account attribute catalog.",
    },
    {
      id: "forms",
      pattern: "forms/*.yaml",
      artifact: "OnboardedFormConfig",
      format: "yaml",
      mode: "values",
      description: "Local account forms.",
    },
    {
      id: "formSubscriptions",
      pattern: "forms/library/*.yaml",
      artifact: "OnboardedFormSubscription",
      format: "yaml",
      mode: "values",
      optional: true,
      description: "Library form subscriptions.",
    },
    {
      id: "documents",
      pattern: "documents/*/document.yaml",
      artifact: "OnboardedDocumentConfig",
      format: "yaml",
      optional: true,
      description: "Document manifests.",
    },
    {
      id: "pdfInspections",
      pattern: "documents/*/_generated/*.pdf.inspect.yaml",
      artifact: "OnboardedPdfInspect",
      format: "yaml",
      optional: true,
      description: "Generated PDF field inspections.",
    },
    {
      id: "pdfAnnotations",
      pattern: "documents/*/_generated/*.pdf.annotations.yaml",
      artifact: "OnboardedPdfAnnotationDocument",
      format: "yaml",
      optional: true,
      description: "Generated PDF annotation geometry.",
    },
    {
      id: "pdfMappings",
      pattern: "pdf-mappings/*.yaml",
      artifact: "OnboardedPdfMappingConfig",
      format: "yaml",
      mode: "values",
      optional: true,
      description: "Form-to-PDF mapping declarations.",
    },
    {
      id: "policies",
      pattern: "policies/*.yaml",
      artifact: "OnboardedPolicyConfig",
      format: "yaml",
      mode: "values",
      description: "Policy rules and requirements.",
    },
    {
      id: "automations",
      pattern: "automations/*.yaml",
      artifact: "OnboardedAutomationConfig",
      format: "yaml",
      mode: "values",
      optional: true,
      description: "Account automation definitions.",
    },
    {
      id: "imports",
      pattern: "imports/*.yaml",
      artifact: "OnboardedImportManifest",
      format: "yaml",
      mode: "values",
      optional: true,
      description: "Source import manifests.",
    },
  ],
  algebra: {
    relationSchema: "OnboardedRelationWorkspaceSchema",
    views: [
      "relationGraph",
      "entityIndex",
      "definitionLocations",
      "references",
      "relationDiagnostics",
      "referenceDiagnostics",
      "patchSuggestions",
    ],
  },
} as const satisfies ArtifactProjectConfig;

export const OnboardedArtifactProjectEnvironment = {
  OnboardedAccountConfig: schemaArtifact(OnboardedAccountConfigSchema),
  OnboardedAttributeCatalog: schemaArtifact(OnboardedAttributeCatalogSchema),
  OnboardedFormConfig: schemaArtifact(OnboardedFormConfigSchema),
  OnboardedFormSubscription: schemaArtifact(OnboardedFormSubscriptionSchema),
  OnboardedDocumentConfig: schemaArtifact(OnboardedDocumentConfigSchema),
  OnboardedPdfInspect: schemaArtifact(OnboardedPdfInspectSchema),
  OnboardedPdfAnnotationDocument: schemaArtifact(OnboardedPdfAnnotationDocumentSchema),
  OnboardedPdfMappingConfig: schemaArtifact(OnboardedPdfMappingConfigSchema),
  OnboardedPolicyConfig: schemaArtifact(OnboardedPolicyConfigSchema),
  OnboardedAutomationConfig: schemaArtifact(OnboardedAutomationConfigSchema),
  OnboardedImportManifest: schemaArtifact(OnboardedImportManifestSchema),
} satisfies Readonly<Record<string, ArtifactProjectConfigArtifact>>;

export function createOnboardedArtifactProject(
  config: OnboardedArtifactProjectConfig = OnboardedArtifactProjectConfigDefinition,
): ArtifactProjectDeclaration<string, any, any> {
  return ArtifactProject.fromConfig(config, {
    artifacts: OnboardedArtifactProjectEnvironment,
  });
}

export const OnboardedArtifactProject = createOnboardedArtifactProject();

export function parseOnboardedArtifactProjectConfig(text: string): OnboardedArtifactProjectConfig {
  const result = decodeYamlEither(OnboardedArtifactProjectConfigSchema, text);
  if (Result.isSuccess(result)) return result.success;
  throw new Error(SchemaIssue.makeFormatterDefault()(result.failure));
}

export function serializeOnboardedArtifactProjectConfig(
  config: OnboardedArtifactProjectConfig = Schema.decodeUnknownSync(
    OnboardedArtifactProjectConfigSchema,
  )(ArtifactProject.toConfig(OnboardedArtifactProject)),
): string {
  return stringifyDocument(config, "yaml");
}

function schemaArtifact(schema: Schema.Schema<unknown>): ArtifactProjectConfigArtifact {
  return {
    type: SchemaIdeWorkspaceFileArtifact as unknown as AnyArtifactType,
    schema,
  };
}
