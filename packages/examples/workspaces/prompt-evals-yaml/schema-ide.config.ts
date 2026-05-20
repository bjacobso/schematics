import { defineSchemaIdeWorkspace } from "@schema-ide/cli";
import { PromptEvalWorkspaceSchema } from "../../src/schemas";

export default defineSchemaIdeWorkspace({
  id: "prompt-evals-yaml",
  schema: PromptEvalWorkspaceSchema,
  defaultFormat: "yaml",
  include: ["**/*.yaml"],
});
