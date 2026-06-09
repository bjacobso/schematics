import { Project } from "@schematics/core";
import { deriveArtifactProject, deriveProjectSchema } from "@schematics/provider";
import { oktaResources } from "./resources";
import { OktaWorkspaceSchema } from "./schema";

export const OktaArtifactProject = deriveArtifactProject({
  id: "okta-yaml",
  resources: oktaResources,
  include: ["**/*.yaml", "config.lock.json", ".env", ".env.*"],
  metadata: ["config.lock.json"],
  secret: [".env", ".env.*"],
});

export const OktaProjectBaseSchema = Project.fromArtifactProject(OktaArtifactProject) as any;

export const OktaProjectSchema = deriveProjectSchema(
  OktaArtifactProject,
  OktaWorkspaceSchema as any,
  oktaResources,
  { label: "okta identity references resolve", fallbackDocument: "groups" },
);
