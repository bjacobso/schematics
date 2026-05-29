import { defineSchemaIdeProject } from "@schema-ide/cli";
import { PromptEvalArtifactProject, PromptEvalWorkspaceSchema } from "../../src/schemas";

export default defineSchemaIdeProject({
  id: "prompt-evals-yaml",
  project: PromptEvalArtifactProject,
  schema: PromptEvalWorkspaceSchema,
  defaultFormat: "yaml",
  include: ["**/*.yaml"],
});
