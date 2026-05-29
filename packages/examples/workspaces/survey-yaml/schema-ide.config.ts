import { defineSchemaIdeProject } from "@schema-ide/cli";
import { SurveyArtifactProject, SurveyWorkspaceSchema } from "../../src/schemas";

export default defineSchemaIdeProject({
  id: "survey-yaml",
  project: SurveyArtifactProject,
  schema: SurveyWorkspaceSchema,
  defaultFormat: "yaml",
  include: ["**/*.yaml", "**/*.pdf"],
});
