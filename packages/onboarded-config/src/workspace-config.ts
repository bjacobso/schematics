import { defineSchemaIdeWorkspace } from "@schema-ide/cli";
import { OnboardedArtifactProject } from "./artifacts";
import { OnboardedAccountWorkspaceSchema } from "./workspace";

export const OnboardedConfigWorkspace = defineSchemaIdeWorkspace({
  id: "onboarded-account-yaml",
  schema: OnboardedAccountWorkspaceSchema,
  artifactProject: OnboardedArtifactProject,
  defaultFormat: "yaml",
  include: ["**/*.yaml", "**/*.pdf", "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.webp"],
});
