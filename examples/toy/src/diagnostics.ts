import type { SchematicsDiagnostic, SourceFile } from "@schematics/core";
import { deriveWorkspaceDiagnostics } from "@schematics/provider";
import { toyResources } from "./resources";
import { ToyWorkspaceSchema, type ToyWorkspaceValue } from "./schema";

const diagnoseToyWorkspace = deriveWorkspaceDiagnostics(ToyWorkspaceSchema, toyResources, {
  fallbackDocument: "toy",
});

export function validateToyWorkspaceValue(
  workspace: ToyWorkspaceValue,
  _files: readonly SourceFile[] = [],
): readonly SchematicsDiagnostic[] {
  return diagnoseToyWorkspace(workspace);
}
