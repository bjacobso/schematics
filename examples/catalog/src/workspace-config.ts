import { defineSchematicsProject } from "@schematics/cli";
import { validateCatalogWorkspaceValue } from "./diagnostics";
import { CatalogArtifactProject, CatalogProjectBaseSchema } from "./project";
import { CatalogWorkspaceSchema, type CatalogWorkspaceValue } from "./schema";

/** The schematics project definition consumed by the IDE CLI + SEA binary build. */
export const CatalogConfigProject = defineSchematicsProject<CatalogWorkspaceValue>({
  id: "nyc-library-yaml",
  project: CatalogArtifactProject,
  relationInputSchema: CatalogProjectBaseSchema as any,
  relationSchema: CatalogWorkspaceSchema,
  projectDiagnostics: (value, context) => validateCatalogWorkspaceValue(value, context.files),
  defaultFormat: "yaml",
  include: ["**/*.yaml"],
});
