import { defineSchemaIdeProject } from "@schema-ide/cli";
import { OnboardedArtifactProject } from "./artifacts";
import { OnboardedAccountWorkspaceSchema } from "./workspace";

export const OnboardedConfigWorkspace = defineSchemaIdeProject({
  id: "onboarded-account-yaml",
  project: OnboardedArtifactProject,
  schema: OnboardedAccountWorkspaceSchema,
  defaultFormat: "yaml",
  include: ["**/*.yaml", "**/*.pdf", "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.webp"],
});
