import { defineSchematicsProject } from "@schematics/cli";
import {
  CatalogArtifactProject,
  CatalogProjectBaseSchema,
  CatalogWorkspaceSchema,
  validateCatalogWorkspaceValue,
  type CatalogWorkspaceValue,
} from "@schematics/example-catalog";

export default defineSchematicsProject<CatalogWorkspaceValue>({
  id: "nyc-library-yaml",
  project: CatalogArtifactProject,
  relationInputSchema: CatalogProjectBaseSchema as any,
  relationSchema: CatalogWorkspaceSchema,
  projectDiagnostics: (value, context) => validateCatalogWorkspaceValue(value, context.files),
  defaultFormat: "yaml",
  include: CatalogArtifactProject.config.include,
});
