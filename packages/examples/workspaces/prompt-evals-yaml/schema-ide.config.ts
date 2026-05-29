import { defineSchemaIdeProject } from "@schema-ide/cli";
import { PromptEvalArtifactProject } from "../../src/schemas";

export default defineSchemaIdeProject({
  id: "prompt-evals-yaml",
  project: PromptEvalArtifactProject,
  defaultFormat: "yaml",
  include: ["**/*.yaml"],
});
