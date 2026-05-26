import type {
  PreviewNavigationRegistration,
  SchemaIdePreviewRegistration,
} from "@schema-ide/react";
import { onboardedAccountYamlPreviews } from "../../../packages/onboarded-config/workspaces/onboarded-account-yaml/previews";
import { promptEvalsJsonPreviews } from "../../../packages/examples/workspaces/prompt-evals-json/previews";
import { promptEvalsYamlPreviews } from "../../../packages/examples/workspaces/prompt-evals-yaml/previews";
import { surveyYamlPreviews } from "../../../packages/examples/workspaces/survey-yaml/previews";
import { workflowJsonPreviews } from "../../../packages/examples/workspaces/workflow-json/previews";

const playgroundPreviewsByExampleId: Readonly<
  Record<string, readonly SchemaIdePreviewRegistration[]>
> = {
  "onboarded-account-yaml": onboardedAccountYamlPreviews,
  "prompt-evals-json": promptEvalsJsonPreviews,
  "prompt-evals-yaml": promptEvalsYamlPreviews,
  "survey-yaml": surveyYamlPreviews,
  "workflow-json": workflowJsonPreviews,
};

export function getPlaygroundPreviews(exampleId: string): readonly SchemaIdePreviewRegistration[] {
  return playgroundPreviewsByExampleId[exampleId] ?? [];
}

const playgroundPreviewNavigationByExampleId: Readonly<
  Record<string, readonly PreviewNavigationRegistration[]>
> = {
  "onboarded-account-yaml": [
    { path: "forms", label: "Forms", itemPattern: "forms/**/*.yaml", getItemLabel: labelFromValue },
    {
      path: "policies",
      label: "Policies",
      itemPattern: "policies/**/*.yaml",
      getItemLabel: labelFromValue,
    },
    {
      path: "documents",
      label: "Documents",
      itemPattern: "documents/**/*.yaml",
      getItemLabel: labelFromValue,
    },
    {
      path: "automations",
      label: "Automations",
      itemPattern: "automations/**/*.yaml",
      getItemLabel: labelFromValue,
    },
    {
      path: "imports",
      label: "Imports",
      itemPattern: "imports/**/*.yaml",
      getItemLabel: labelFromValue,
    },
    {
      path: "pdf-mappings",
      label: "PDF mappings",
      itemPattern: "pdf-mappings/**/*.yaml",
      getItemLabel: labelFromValue,
    },
  ],
  "prompt-evals-json": [
    {
      path: "prompts",
      label: "Prompts",
      itemPattern: "prompts/**/*.json",
      getItemLabel: labelFromValue,
    },
    { path: "evals", label: "Evals", itemPattern: "evals/**/*.json", getItemLabel: labelFromValue },
    {
      path: "datasets",
      label: "Datasets",
      itemPattern: "datasets/**/*.json",
      getItemLabel: labelFromValue,
    },
  ],
  "prompt-evals-yaml": [
    {
      path: "prompts",
      label: "Prompts",
      itemPattern: "prompts/**/*.yaml",
      getItemLabel: labelFromValue,
    },
    { path: "evals", label: "Evals", itemPattern: "evals/**/*.yaml", getItemLabel: labelFromValue },
    {
      path: "datasets",
      label: "Datasets",
      itemPattern: "datasets/**/*.yaml",
      getItemLabel: labelFromValue,
    },
  ],
  "survey-yaml": [
    { path: "forms", label: "Forms", itemPattern: "forms/**/*.yaml", getItemLabel: labelFromValue },
    {
      path: "questions",
      label: "Questions",
      itemPattern: "questions/**/*.yaml",
      getItemLabel: labelFromValue,
    },
    {
      path: "surveys",
      label: "Surveys",
      itemPattern: "surveys/**/*.yaml",
      getItemLabel: labelFromValue,
    },
  ],
  "workflow-json": [
    {
      path: "workflows",
      label: "Workflows",
      itemPattern: "workflows/**/*.json",
      getItemLabel: labelFromValue,
    },
    {
      path: "actions",
      label: "Actions",
      itemPattern: "actions/**/*.json",
      getItemLabel: labelFromValue,
    },
  ],
};

export function getPlaygroundPreviewNavigation(
  exampleId: string,
): readonly PreviewNavigationRegistration[] {
  return playgroundPreviewNavigationByExampleId[exampleId] ?? [];
}

function labelFromValue({
  value,
  file,
}: Parameters<NonNullable<PreviewNavigationRegistration["getItemLabel"]>>[0]): string {
  if (value && typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    const label = record["name"] ?? record["title"] ?? record["id"];
    if (typeof label === "string" && label.trim()) return label;
  }
  return file.path
    .split("/")
    .at(-1)!
    .replace(/\.[^.]+$/, "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
