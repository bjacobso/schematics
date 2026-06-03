import { defineSchematicsProject } from "@schematics/cli";
import { WorkflowArtifactProject } from "@schematics/example-workflow";

export default defineSchematicsProject({
  id: "workflow-json",
  project: WorkflowArtifactProject,
  defaultFormat: "json",
  include: ["**/*.json"],
});
