import { defineSchematicsProject } from "@schematics/cli";
import {
  ToyArtifactProject,
  ToyProjectBaseSchema,
  ToyWorkspaceSchema,
  validateToyWorkspaceValue,
  type ToyWorkspaceValue,
} from "@schematics/example-toy";

export default defineSchematicsProject<ToyWorkspaceValue>({
  id: "toy-yaml",
  project: ToyArtifactProject,
  relationInputSchema: ToyProjectBaseSchema as any,
  relationSchema: ToyWorkspaceSchema,
  projectDiagnostics: (value) => validateToyWorkspaceValue(value),
  defaultFormat: "yaml",
  include: ["**/*.yaml"],
});
