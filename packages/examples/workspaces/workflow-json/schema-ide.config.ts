import { defineSchemaIdeProject } from "@schema-ide/cli";
import { WorkflowArtifactProject, WorkflowWorkspaceSchema } from "../../src/schemas";

export default defineSchemaIdeProject({
  id: "workflow-json",
  project: WorkflowArtifactProject,
  schema: WorkflowWorkspaceSchema,
  defaultFormat: "json",
  include: ["**/*.json"],
});
