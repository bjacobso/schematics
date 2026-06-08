import { defaultPreviewNavigationLabel, type PreviewNavigationRegistration } from "@schematics/ide";

// Shared by every toy project (valid, broken-refs, duplicate-ids): a two-entry
// directory navigation. The toy flavor ships no previews or deploy engine.
const navigation: readonly PreviewNavigationRegistration[] = [
  { path: "cards", label: "Cards", itemPattern: "cards/**/*.yaml" },
  { path: "decks", label: "Decks", itemPattern: "decks/**/*.yaml" },
].map((entry) => ({ ...entry, getItemLabel: defaultPreviewNavigationLabel }));

export const toyProductSurface: {
  readonly previewNavigation: readonly PreviewNavigationRegistration[];
} = {
  previewNavigation: navigation,
};
