import type { PreviewNavigationRegistration, SchematicsPreviewRegistration } from "@schematics/ide";
import { nycLibraryPreviews } from "../../../examples/catalog/projects/nyc-public-library/previews";

const playgroundPreviewsByExampleId: Readonly<
  Record<string, readonly SchematicsPreviewRegistration[]>
> = {
  "nyc-library-yaml": nycLibraryPreviews,
};

export function getPlaygroundPreviews(exampleId: string): readonly SchematicsPreviewRegistration[] {
  return playgroundPreviewsByExampleId[exampleId] ?? [];
}

const catalogNavigation: readonly PreviewNavigationRegistration[] = [
  { path: "branches", label: "Branches", itemPattern: "branches/**/*.yaml", getItemLabel: labelFromValue },
  { path: "authors", label: "Authors", itemPattern: "authors/**/*.yaml", getItemLabel: labelFromValue },
  { path: "shelves", label: "Shelves", itemPattern: "shelves/**/*.yaml", getItemLabel: labelFromValue },
  { path: "items", label: "Items", itemPattern: "items/**/*.yaml", getItemLabel: labelFromValue },
  {
    path: "collections",
    label: "Collections",
    itemPattern: "collections/**/*.yaml",
    getItemLabel: labelFromValue,
  },
  { path: "policies", label: "Policies", itemPattern: "policies/**/*.yaml", getItemLabel: labelFromValue },
];

const toyNavigation: readonly PreviewNavigationRegistration[] = [
  { path: "cards", label: "Cards", itemPattern: "cards/**/*.yaml", getItemLabel: labelFromValue },
  { path: "decks", label: "Decks", itemPattern: "decks/**/*.yaml", getItemLabel: labelFromValue },
];

const playgroundPreviewNavigationByExampleId: Readonly<
  Record<string, readonly PreviewNavigationRegistration[]>
> = {
  "nyc-library-yaml": catalogNavigation,
  "toy-valid": toyNavigation,
  "toy-broken-refs": toyNavigation,
  "toy-duplicate-ids": toyNavigation,
};

export function getPlaygroundPreviewNavigation(
  exampleId: string,
): readonly PreviewNavigationRegistration[] {
  return playgroundPreviewNavigationByExampleId[exampleId] ?? [];
}

function labelFromValue({
  value,
  file,
}: Parameters<NonNullable<PreviewNavigationRegistration["getItemLabel"]>>[0]): string {
  if (value && typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    const label = record["name"] ?? record["title"] ?? record["label"] ?? record["id"];
    if (typeof label === "string" && label.trim()) return label;
  }
  return file.path
    .split("/")
    .at(-1)!
    .replace(/\.[^.]+$/, "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
