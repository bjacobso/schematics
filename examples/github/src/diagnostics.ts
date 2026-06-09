import type { SchematicsDiagnostic, SourceFile } from "@schematics/core";
import { deriveWorkspaceDiagnostics } from "@schematics/provider";
import { githubResources } from "./resources";
import { GitHubWorkspaceSchema, type GitHubWorkspaceValue } from "./schema";

const diagnoseGitHubWorkspace = deriveWorkspaceDiagnostics(
  GitHubWorkspaceSchema,
  githubResources,
  {
    fallbackDocument: "teams",
  },
);

/** Cross-file workspace diagnostics: duplicate ids and unresolved references. */
export function validateGitHubWorkspaceValue(
  workspace: GitHubWorkspaceValue,
  _files: readonly SourceFile[] = [],
): readonly SchematicsDiagnostic[] {
  return diagnoseGitHubWorkspace(workspace);
}
