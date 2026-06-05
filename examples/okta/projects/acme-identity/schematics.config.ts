import { defineSchematicsProject } from "@schematics/cli";
import {
  OktaArtifactProject,
  OktaProjectBaseSchema,
  OktaWorkspaceSchema,
  validateOktaWorkspaceValue,
  type OktaWorkspaceValue,
} from "@schematics/example-okta";

export default defineSchematicsProject<OktaWorkspaceValue>({
  id: "okta-yaml",
  project: OktaArtifactProject,
  relationInputSchema: OktaProjectBaseSchema as any,
  relationSchema: OktaWorkspaceSchema,
  projectDiagnostics: (value) => validateOktaWorkspaceValue(value),
  defaultFormat: "yaml",
  include: ["**/*.yaml"],
});
