import { defineSchemaIdeWorkspace } from "@schema-ide/cli";
import { OnboardedAccountWorkspaceSchema } from "@schema-ide/onboarded-config";

export default defineSchemaIdeWorkspace({
  id: "onboarded-account-yaml",
  schema: OnboardedAccountWorkspaceSchema,
  defaultFormat: "yaml",
  include: ["**/*.yaml", "**/*.pdf", "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.webp"],
});
