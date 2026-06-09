import { Project } from "@schematics/core";
import { deriveArtifactProject, deriveProjectSchema } from "@schematics/provider";
import { githubResources } from "./resources";
import { GitHubWorkspaceSchema } from "./schema";

export const GitHubArtifactProject = deriveArtifactProject({
  id: "github-yaml",
  resources: githubResources,
  include: ["**/*.yaml", "config.lock.json", ".env", ".env.*"],
  metadata: ["config.lock.json"],
  secret: [".env", ".env.*"],
});

export const GitHubProjectBaseSchema = Project.fromArtifactProject(GitHubArtifactProject) as any;

export const GitHubProjectSchema = deriveProjectSchema(
  GitHubArtifactProject,
  GitHubWorkspaceSchema as any,
  githubResources,
  { label: "github org references resolve", fallbackDocument: "teams" },
);
