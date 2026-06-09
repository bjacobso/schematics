import { Project } from "@schematics/core";
import { deriveArtifactProject, deriveProjectSchema } from "@schematics/provider";
import { toyResources } from "./resources";
import { ToyWorkspaceSchema } from "./schema";

export const ToyArtifactProject = deriveArtifactProject({
  id: "toy-yaml",
  resources: toyResources,
  include: ["**/*.yaml", "config.lock.json", ".env", ".env.*"],
  metadata: ["config.lock.json"],
  secret: [".env", ".env.*"],
});

export const ToyProjectBaseSchema = Project.fromArtifactProject(ToyArtifactProject) as any;

export const ToyProjectSchema = deriveProjectSchema(
  ToyArtifactProject,
  ToyWorkspaceSchema as any,
  toyResources,
  { label: "toy deck references resolve", fallbackDocument: "toy" },
);
