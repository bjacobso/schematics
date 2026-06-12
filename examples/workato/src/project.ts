import { Project } from "@schematics/core";
import { deriveArtifactProject, deriveProjectSchema } from "@schematics/provider";
import { workatoResources } from "./resources";
import { WorkatoWorkspaceSchema } from "./schema";

export const WorkatoArtifactProject = deriveArtifactProject({
  id: "workato-yaml",
  resources: workatoResources,
  include: ["**/*.yaml", "config.lock.json", ".env", ".env.*"],
  metadata: ["config.lock.json"],
  secret: [".env", ".env.*"],
});

export const WorkatoProjectBaseSchema = Project.fromArtifactProject(WorkatoArtifactProject) as any;

export const WorkatoProjectSchema = deriveProjectSchema(
  WorkatoArtifactProject,
  WorkatoWorkspaceSchema as any,
  workatoResources,
  { label: "workato automation references resolve", fallbackDocument: "recipes" },
);
