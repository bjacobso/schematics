import { defineSchemaIdeWorkspace } from "@schema-ide/cli";
import { OnboardedAccountWorkspaceSchema } from "./workspace";

export const OnboardedConfigWorkspace = defineSchemaIdeWorkspace({
  id: "onboarded-account-yaml",
  schema: OnboardedAccountWorkspaceSchema,
  defaultFormat: "yaml",
  include: ["**/*.yaml", "**/*.pdf", "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.webp"],
});
