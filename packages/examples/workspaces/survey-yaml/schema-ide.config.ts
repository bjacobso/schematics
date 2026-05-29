import { defineSchemaIdeWorkspace } from "@schema-ide/cli";
import { SurveyArtifactProject, SurveyWorkspaceSchema } from "../../src/schemas";

export default defineSchemaIdeWorkspace({
  id: "survey-yaml",
  schema: SurveyWorkspaceSchema,
  artifactProject: SurveyArtifactProject,
  defaultFormat: "yaml",
  include: ["**/*.yaml", "**/*.pdf"],
});
