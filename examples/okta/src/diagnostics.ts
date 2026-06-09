import type { SchematicsDiagnostic, SourceFile } from "@schematics/core";
import { deriveWorkspaceDiagnostics } from "@schematics/provider";
import { oktaResources } from "./resources";
import { OktaWorkspaceSchema, type OktaWorkspaceValue } from "./schema";

const diagnoseOktaWorkspace = deriveWorkspaceDiagnostics(OktaWorkspaceSchema, oktaResources, {
  fallbackDocument: "groups",
});

export function validateOktaWorkspaceValue(
  workspace: OktaWorkspaceValue,
  _files: readonly SourceFile[] = [],
): readonly SchematicsDiagnostic[] {
  return diagnoseOktaWorkspace(workspace);
}
