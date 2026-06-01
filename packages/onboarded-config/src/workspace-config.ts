import { defineSchemaIdeProject } from "@schema-ide/cli";
import { OnboardedArtifactProject } from "./artifacts";
import { OnboardedRelationWorkspaceSchema, createOnboardedRelationWorkspace } from "./relations";
import {
  OnboardedAccountWorkspaceBaseSchema,
  validateOnboardedAccountWorkspaceValue,
  type AccountWorkspaceValue,
} from "./workspace";

export const OnboardedConfigProject = defineSchemaIdeProject<AccountWorkspaceValue>({
  id: "onboarded-account-yaml",
  project: OnboardedArtifactProject,
  relationInputSchema: OnboardedAccountWorkspaceBaseSchema as any,
  relationSchema: OnboardedRelationWorkspaceSchema,
  relationValue: createOnboardedRelationWorkspace,
  projectDiagnostics: (value, context) =>
    validateOnboardedAccountWorkspaceValue(value, context.files),
  defaultFormat: "yaml",
  include: ["**/*.yaml", "**/*.pdf", "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.webp"],
});
