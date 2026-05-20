import { defineSchemaIdeWorkspace } from "@schema-ide/cli";
import { OnboardedAccountWorkspaceSchema } from "../../src/schemas";

export default defineSchemaIdeWorkspace({
  id: "onboarded-account-yaml",
  schema: OnboardedAccountWorkspaceSchema,
  defaultFormat: "yaml",
  include: ["**/*.yaml"],
});
