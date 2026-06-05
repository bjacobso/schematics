import { defineSchematicsProject } from "@schematics/cli";
import {
  GitHubArtifactProject,
  GitHubProjectBaseSchema,
  GitHubWorkspaceSchema,
  validateGitHubWorkspaceValue,
  type GitHubWorkspaceValue,
} from "@schematics/example-github";

export default defineSchematicsProject<GitHubWorkspaceValue>({
  id: "github-yaml",
  project: GitHubArtifactProject,
  relationInputSchema: GitHubProjectBaseSchema as any,
  relationSchema: GitHubWorkspaceSchema,
  projectDiagnostics: (value) => validateGitHubWorkspaceValue(value),
  defaultFormat: "yaml",
  include: ["**/*.yaml"],
});
