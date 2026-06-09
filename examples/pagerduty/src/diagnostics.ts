import type { SchematicsDiagnostic, SourceFile } from "@schematics/core";
import { deriveWorkspaceDiagnostics } from "@schematics/provider";
import { pagerDutyResources } from "./resources";
import { PagerDutyWorkspaceSchema, type PagerDutyWorkspaceValue } from "./schema";

const diagnosePagerDutyWorkspace = deriveWorkspaceDiagnostics(
  PagerDutyWorkspaceSchema,
  pagerDutyResources,
  { fallbackDocument: "services" },
);

export function validatePagerDutyWorkspaceValue(
  workspace: PagerDutyWorkspaceValue,
  _files: readonly SourceFile[] = [],
): readonly SchematicsDiagnostic[] {
  return diagnosePagerDutyWorkspace(workspace);
}
