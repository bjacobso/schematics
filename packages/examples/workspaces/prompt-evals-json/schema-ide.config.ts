import { defineSchemaIdeProject } from "@schema-ide/cli";
import { PromptEvalArtifactProject, PromptEvalWorkspaceSchema } from "../../src/schemas";

export default defineSchemaIdeProject({
  id: "prompt-evals-json",
  project: PromptEvalArtifactProject,
  schema: PromptEvalWorkspaceSchema,
  defaultFormat: "json",
  include: ["**/*.json"],
});
