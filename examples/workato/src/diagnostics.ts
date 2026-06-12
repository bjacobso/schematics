import type { SchematicsDiagnostic, SourceFile } from "@schematics/core";
import { deriveWorkspaceDiagnostics } from "@schematics/provider";
import { workatoResources } from "./resources";
import { WorkatoWorkspaceSchema, type WorkatoWorkspaceValue } from "./schema";

const diagnoseWorkatoWorkspace = deriveWorkspaceDiagnostics(
  WorkatoWorkspaceSchema,
  workatoResources,
  { fallbackDocument: "recipes" },
);

export function validateWorkatoWorkspaceValue(
  workspace: WorkatoWorkspaceValue,
  _files: readonly SourceFile[] = [],
): readonly SchematicsDiagnostic[] {
  return diagnoseWorkatoWorkspace(workspace);
}
