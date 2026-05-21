import { defineSchemaIdeWorkspace } from "@schema-ide/cli";
import { SurveyWorkspaceSchema } from "../../src/schemas";

export default defineSchemaIdeWorkspace({
  id: "survey-yaml",
  schema: SurveyWorkspaceSchema,
  defaultFormat: "yaml",
  include: ["**/*.yaml", "**/*.pdf"],
});
