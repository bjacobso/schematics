import { defineSchemaIdeProject } from "@schema-ide/cli";
import { PromptEvalArtifactProject } from "../../src/schemas";

export default defineSchemaIdeProject({
  id: "prompt-evals-json",
  project: PromptEvalArtifactProject,
  defaultFormat: "json",
  include: ["**/*.json"],
});
