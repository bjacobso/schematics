import type { PreviewNavigationRegistration, SchematicsPreviewRegistration } from "@schematics/ide";
import { onboardedAccountYamlPreviews } from "../../../examples/onboarded/projects/onboarded-account-yaml/previews";
import { surveyYamlPreviews } from "../../../examples/survey/previews";
import { workflowJsonPreviews } from "../../../examples/workflow/previews";

const playgroundPreviewsByExampleId: Readonly<
  Record<string, readonly SchematicsPreviewRegistration[]>
> = {
  "onboarded-account-yaml": onboardedAccountYamlPreviews,
  "survey-yaml": surveyYamlPreviews,
  "workflow-json": workflowJsonPreviews,
};

export function getPlaygroundPreviews(exampleId: string): readonly SchematicsPreviewRegistration[] {
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
