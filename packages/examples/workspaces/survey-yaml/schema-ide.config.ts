import { defineSchemaIdeProject } from "@schema-ide/cli";
import { SurveyArtifactProject } from "../../src/schemas";

export default defineSchemaIdeProject({
  id: "survey-yaml",
  project: SurveyArtifactProject,
  defaultFormat: "yaml",
  include: ["**/*.yaml", "**/*.pdf"],
});
