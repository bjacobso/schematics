import { Project } from "@schematics/core";
import { deriveArtifactProject, deriveProjectSchema } from "@schematics/provider";
import { catalogResources } from "./resources";
import { CatalogWorkspaceSchema } from "./schema";

/**
 * The schema-routed artifact project — derived from {@link catalogResources}
 * via the provider DSL (one `.files()` route per resource). `single` ⇒ one
 * value (the catalog container); otherwise an array.
 */
export const CatalogArtifactProject = deriveArtifactProject({
  id: "nyc-library-yaml",
  resources: catalogResources,
  include: ["**/*.yaml", "config.lock.json", ".env", ".env.*"],
  metadata: ["config.lock.json"],
  secret: [".env", ".env.*"],
});

/** The routed workspace schema (catalog single + entity arrays). */
export const CatalogProjectBaseSchema = Project.fromArtifactProject(CatalogArtifactProject) as any;

/** The full project schema: routed shape + cross-file relation diagnostics. */
export const CatalogProjectSchema = deriveProjectSchema(
  CatalogArtifactProject,
  CatalogWorkspaceSchema as any,
  catalogResources,
  { label: "catalog workspace references resolve", fallbackDocument: "catalog" },
);
