import type { SchematicsDiagnostic, SourceFile } from "@schematics/core";
import { deriveWorkspaceDiagnostics } from "@schematics/provider";
import { salesforceResources } from "./resources";
import { SalesforceWorkspaceSchema, type SalesforceWorkspaceValue } from "./schema";

const diagnoseSalesforceWorkspace = deriveWorkspaceDiagnostics(
  SalesforceWorkspaceSchema,
  salesforceResources,
  { fallbackDocument: "org" },
);

export function validateSalesforceWorkspaceValue(
  workspace: SalesforceWorkspaceValue,
  _files: readonly SourceFile[] = [],
): readonly SchematicsDiagnostic[] {
  return diagnoseSalesforceWorkspace(workspace);
}
