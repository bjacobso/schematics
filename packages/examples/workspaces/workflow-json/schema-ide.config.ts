import { defineSchemaIdeWorkspace } from "@schema-ide/cli";
import { WorkflowWorkspaceSchema } from "../../src/schemas";

export default defineSchemaIdeWorkspace({
  id: "workflow-json",
  schema: WorkflowWorkspaceSchema,
  defaultFormat: "json",
  include: ["**/*.json"],
});
