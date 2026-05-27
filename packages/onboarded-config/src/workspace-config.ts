import { defineSchemaIdeWorkspace } from "@schema-ide/cli";
import type { SchemaIdeWorkspaceArtifact, SchemaIdeWorkspaceTool } from "@schema-ide/core";
import { OnboardedAccountWorkspaceSchema } from "./workspace";

export const OnboardedConfigArtifacts = [
  {
    id: "account-forms",
    kind: "source",
    path: ["forms/*.yaml", "forms/library/*.yaml"],
    schemaId: "OnboardedForms",
    contentType: "application/yaml",
  },
  {
    id: "document-config",
    kind: "source",
    path: "documents/:document/document.yaml",
    entity: ["document"],
    schemaId: "OnboardedDocuments",
    contentType: "application/yaml",
  },
  {
    id: "source-pdf",
    kind: "source",
    path: "documents/:document/*.pdf",
    entity: ["document"],
    contentType: "application/pdf",
  },
  {
    id: "pdf-screenshots",
    kind: "generated",
    path: "documents/:document/_generated/screenshots/page-*.png",
    entity: ["document"],
    contentType: "image/png",
    policy: "read-only",
  },
  {
    id: "pdf-inspection",
    kind: "generated",
    path: "documents/:document/_generated/*.inspect.yaml",
    entity: ["document"],
    schemaId: "OnboardedPdfInspections",
    contentType: "application/yaml",
    policy: "read-only",
  },
  {
    id: "pdf-annotations",
    kind: "generated",
    path: "documents/:document/_generated/*.annotations.yaml",
    entity: ["document"],
    schemaId: "OnboardedPdfAnnotations",
    contentType: "application/yaml",
    policy: "promotable",
  },
  {
    id: "pdf-mapping",
    kind: "source",
    path: "pdf-mappings/*.yaml",
    schemaId: "OnboardedPdfMappings",
    contentType: "application/yaml",
    policy: "editable",
  },
] satisfies readonly SchemaIdeWorkspaceArtifact[];

export const OnboardedConfigTools = [
  {
    id: "inspect-pdf",
    label: "Inspect PDF fields",
    inputs: ["source-pdf"],
    outputs: ["pdf-inspection"],
    uiCallable: true,
    cliCallable: true,
  },
  {
    id: "render-pdf-screenshots",
    label: "Render PDF screenshots",
    inputs: ["source-pdf"],
    outputs: ["pdf-screenshots"],
    uiCallable: true,
    cliCallable: true,
  },
  {
    id: "annotate-pdf",
    label: "Annotate PDF fields",
    inputs: ["source-pdf", "pdf-inspection"],
    outputs: ["pdf-annotations"],
    model: true,
    agentCallable: true,
    uiCallable: true,
    cliCallable: true,
    requiresApproval: true,
  },
  {
    id: "suggest-pdf-mapping",
    label: "Suggest PDF mapping",
    inputs: ["account-forms", "pdf-inspection", "pdf-annotations"],
    outputs: ["pdf-mapping"],
    model: true,
    agentCallable: true,
    uiCallable: true,
    cliCallable: true,
    requiresApproval: true,
  },
] satisfies readonly SchemaIdeWorkspaceTool[];

export const OnboardedConfigWorkspace = defineSchemaIdeWorkspace({
  id: "onboarded-account-yaml",
  schema: OnboardedAccountWorkspaceSchema,
  defaultFormat: "yaml",
  include: ["**/*.yaml", "**/*.pdf", "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.webp"],
  artifacts: OnboardedConfigArtifacts,
  tools: OnboardedConfigTools,
});
