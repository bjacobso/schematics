import { readFileSync } from "node:fs";
import { defineSchemaIdeProject } from "@schema-ide/cli";
import {
  OnboardedAccountWorkspaceSchema,
  createOnboardedArtifactProject,
  parseOnboardedArtifactProjectConfig,
} from "../../src/index";

const artifactProjectConfig = parseOnboardedArtifactProjectConfig(
  readFileSync(new URL("./artifact-project.yaml", import.meta.url), "utf8"),
);

export default defineSchemaIdeProject({
  id: artifactProjectConfig.id,
  project: createOnboardedArtifactProject(artifactProjectConfig),
  schema: OnboardedAccountWorkspaceSchema,
  defaultFormat: artifactProjectConfig.defaultFormat,
  include: artifactProjectConfig.include,
});
