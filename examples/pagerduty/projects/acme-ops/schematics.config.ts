import { defineSchematicsProject } from "@schematics/cli";
import {
  PagerDutyArtifactProject,
  PagerDutyProjectBaseSchema,
  PagerDutyWorkspaceSchema,
  validatePagerDutyWorkspaceValue,
  type PagerDutyWorkspaceValue,
} from "@schematics/example-pagerduty";

export default defineSchematicsProject<PagerDutyWorkspaceValue>({
  id: "pagerduty-yaml",
  project: PagerDutyArtifactProject,
  relationInputSchema: PagerDutyProjectBaseSchema as any,
  relationSchema: PagerDutyWorkspaceSchema,
  projectDiagnostics: (value) => validatePagerDutyWorkspaceValue(value),
  defaultFormat: "yaml",
  include: ["**/*.yaml"],
});
