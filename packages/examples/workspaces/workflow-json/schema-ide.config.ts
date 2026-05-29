import { defineSchemaIdeProject } from "@schema-ide/cli";
import { WorkflowArtifactProject } from "../../src/schemas";

export default defineSchemaIdeProject({
  id: "workflow-json",
  project: WorkflowArtifactProject,
  defaultFormat: "json",
  include: ["**/*.json"],
});
