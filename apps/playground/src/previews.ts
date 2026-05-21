import type { SchemaIdePreviewRegistration } from "@schema-ide/react";
import { onboardedAccountYamlPreviews } from "../../../packages/examples/workspaces/onboarded-account-yaml/previews";
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
