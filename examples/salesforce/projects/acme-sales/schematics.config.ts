import { defineSchematicsProject } from "@schematics/cli";
import {
  SalesforceArtifactProject,
  SalesforceProjectBaseSchema,
  SalesforceWorkspaceSchema,
  validateSalesforceWorkspaceValue,
  type SalesforceWorkspaceValue,
} from "@schematics/example-salesforce";

export default defineSchematicsProject<SalesforceWorkspaceValue>({
  id: "salesforce-yaml",
  project: SalesforceArtifactProject,
  relationInputSchema: SalesforceProjectBaseSchema as any,
  relationSchema: SalesforceWorkspaceSchema,
  projectDiagnostics: (value) => validateSalesforceWorkspaceValue(value),
  defaultFormat: "yaml",
  include: ["**/*.yaml"],
});
