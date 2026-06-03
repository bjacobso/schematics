import { defineSchematicsProject } from "@schematics/cli";
import { SurveyArtifactProject } from "@schematics/example-survey";

export default defineSchematicsProject({
  id: "survey-yaml",
  project: SurveyArtifactProject,
  defaultFormat: "yaml",
  include: ["**/*.yaml", "**/*.pdf"],
});
