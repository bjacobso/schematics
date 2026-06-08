import { makeCatalogDeployService } from "@schematics/example-catalog";
import type { SchematicsFlavorDeploy } from "@schematics/core";
import {
  defaultPreviewNavigationLabel,
  type PreviewNavigationRegistration,
  type SchematicsPreviewRegistration,
} from "@schematics/ide";
import { nycLibraryPreviews } from "./previews";

// Patron-facing directory navigation: one entry per resource type, each
// labelling items by their `name`/`title`/`id` (see defaultPreviewNavigationLabel).
const navigation: readonly PreviewNavigationRegistration[] = [
  { path: "branches", label: "Branches", itemPattern: "branches/**/*.yaml" },
  { path: "authors", label: "Authors", itemPattern: "authors/**/*.yaml" },
  { path: "shelves", label: "Shelves", itemPattern: "shelves/**/*.yaml" },
  { path: "items", label: "Items", itemPattern: "items/**/*.yaml" },
  { path: "collections", label: "Collections", itemPattern: "collections/**/*.yaml" },
  { path: "policies", label: "Policies", itemPattern: "policies/**/*.yaml" },
].map((entry) => ({ ...entry, getItemLabel: defaultPreviewNavigationLabel }));

/**
 * The catalog flavor's React + deploy surface, supplied to the harness through
 * the public `@schematics/*` API: read-only previews, directory navigation, and
 * the config-as-code deploy engine. The harness owns the workspace store and
 * clock; this only declares how the catalog visualizes and deploys.
 */
export const nycLibraryProductSurface: {
  readonly previews: readonly SchematicsPreviewRegistration[];
  readonly previewNavigation: readonly PreviewNavigationRegistration[];
  readonly deploy: SchematicsFlavorDeploy;
} = {
  previews: nycLibraryPreviews,
  previewNavigation: navigation,
  deploy: { createService: (options) => makeCatalogDeployService(options) },
};
