import { defineSchemaIdeProject } from "@schema-ide/cli";
import { OnboardedArtifactProject } from "./artifacts";
import { OnboardedRelationProjectSchema, createOnboardedRelationWorkspace } from "./relations";
import {
  OnboardedAccountProjectBaseSchema,
  validateOnboardedAccountWorkspaceValue,
  type AccountWorkspaceValue,
} from "./workspace";

export const OnboardedConfigProject = defineSchemaIdeProject<AccountWorkspaceValue>({
  id: "onboarded-account-yaml",
  project: OnboardedArtifactProject,
  relationInputSchema: OnboardedAccountProjectBaseSchema as any,
  relationSchema: OnboardedRelationProjectSchema,
  relationValue: createOnboardedRelationWorkspace,
  projectDiagnostics: (value, context) =>
    validateOnboardedAccountWorkspaceValue(value, context.files),
  defaultFormat: "yaml",
  include: ["**/*.yaml", "**/*.pdf", "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.webp"],
});
