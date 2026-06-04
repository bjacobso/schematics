import { readFileSync } from "node:fs";
import { defineSchematicsProject } from "@schematics/cli";
import {
  OnboardedAccountProjectBaseSchema,
  OnboardedAccountRelationSchema,
  createOnboardedArtifactProject,
  parseOnboardedArtifactProjectConfig,
  type AccountWorkspaceValue,
  validateOnboardedAccountWorkspaceValue,
} from "../../src/index";

const artifactProjectConfig = parseOnboardedArtifactProjectConfig(
  readFileSync(new URL("./artifact-project.yaml", import.meta.url), "utf8"),
);

export default defineSchematicsProject<AccountWorkspaceValue>({
  id: artifactProjectConfig.id,
  project: createOnboardedArtifactProject(artifactProjectConfig),
  relationInputSchema: OnboardedAccountProjectBaseSchema as any,
  relationSchema: OnboardedAccountRelationSchema,
  projectDiagnostics: (value, context) =>
    validateOnboardedAccountWorkspaceValue(value, context.files),
  defaultFormat: artifactProjectConfig.defaultFormat,
  include: artifactProjectConfig.include,
});
