import { readFileSync } from "node:fs";
import { defineSchemaIdeProject } from "@schema-ide/cli";
import {
  OnboardedAccountWorkspaceBaseSchema,
  OnboardedRelationWorkspaceSchema,
  createOnboardedArtifactProject,
  createOnboardedRelationWorkspace,
  parseOnboardedArtifactProjectConfig,
  type AccountWorkspaceValue,
  validateOnboardedAccountWorkspaceValue,
} from "../../src/index";

const artifactProjectConfig = parseOnboardedArtifactProjectConfig(
  readFileSync(new URL("./artifact-project.yaml", import.meta.url), "utf8"),
);

export default defineSchemaIdeProject<AccountWorkspaceValue>({
  id: artifactProjectConfig.id,
  project: createOnboardedArtifactProject(artifactProjectConfig),
  relationInputSchema: OnboardedAccountWorkspaceBaseSchema as any,
  relationSchema: OnboardedRelationWorkspaceSchema,
  relationValue: createOnboardedRelationWorkspace,
  projectDiagnostics: (value, context) =>
    validateOnboardedAccountWorkspaceValue(value, context.files),
  defaultFormat: artifactProjectConfig.defaultFormat,
  include: artifactProjectConfig.include,
});
