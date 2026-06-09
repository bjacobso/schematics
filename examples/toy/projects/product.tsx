import { ToyConfigDeploy } from "@schematics/example-toy";
import { defaultPreviewNavigationLabel, type PreviewNavigationRegistration } from "@schematics/ide";
import type { SchematicsFlavorDeploy } from "@schematics/core";

// Shared by every toy project (valid, broken-refs, duplicate-ids): a two-entry
// directory navigation plus the provider-derived deploy engine.
const navigation: readonly PreviewNavigationRegistration[] = [
  { path: "cards", label: "Cards", itemPattern: "cards/**/*.yaml" },
  { path: "decks", label: "Decks", itemPattern: "decks/**/*.yaml" },
].map((entry) => ({ ...entry, getItemLabel: defaultPreviewNavigationLabel }));

export const toyProductSurface: {
  readonly previewNavigation: readonly PreviewNavigationRegistration[];
  readonly deploy: SchematicsFlavorDeploy;
} = {
  previewNavigation: navigation,
  deploy: ToyConfigDeploy,
};
