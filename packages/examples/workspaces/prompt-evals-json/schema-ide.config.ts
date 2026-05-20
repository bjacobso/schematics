import { defineSchemaIdeWorkspace } from "@schema-ide/cli";
import { PromptEvalWorkspaceSchema } from "../../src/schemas";

export default defineSchemaIdeWorkspace({
  id: "prompt-evals-json",
  schema: PromptEvalWorkspaceSchema,
  defaultFormat: "json",
  include: ["**/*.json"],
});
