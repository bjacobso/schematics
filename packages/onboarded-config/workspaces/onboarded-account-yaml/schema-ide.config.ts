import { defineSchemaIdeWorkspace } from "@schema-ide/cli";
import { OnboardedAccountWorkspaceSchema, OnboardedArtifactProject } from "../../src/index";

export default defineSchemaIdeWorkspace({
  id: "onboarded-account-yaml",
  schema: OnboardedAccountWorkspaceSchema,
  artifactProject: OnboardedArtifactProject,
  defaultFormat: "yaml",
  include: ["**/*.yaml", "**/*.pdf", "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.webp"],
});
