import {
  CatalogArtifactProject,
  type CollectionConfig,
  type ItemConfig,
} from "@schematics/example-catalog";
import {
  ExampleIcon,
  ExamplePreviewShell,
  InfoGrid,
  PillList,
  Section,
} from "@schematics/example-shared/preview";
import { ArtifactProjectPreview, type SchematicsPreviewComponentProps } from "@schematics/ide";

export const nycLibraryPreviews = ArtifactProjectPreview.make(CatalogArtifactProject, [
  { id: "nyc-library-item", schemaId: "Items", label: "Item", component: ItemPreview },
  {
    id: "nyc-library-collection",
    schemaId: "Collections",
    label: "Collection",
    component: CollectionPreview,
  },
]);

function ItemPreview(props: SchematicsPreviewComponentProps<ItemConfig>) {
  const item = props.value;
  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="item" />}
      title={item?.title ?? "Untitled item"}
      subtitle={item?.homeBranchId ? `Home branch: ${item.homeBranchId}` : undefined}
      diagnostics={props.diagnostics.length}
    >
      <InfoGrid
        items={[
          ["Editions", String(item?.editions?.length ?? 0)],
          ["Copies", String(item?.copies?.length ?? 0)],
          ["Holds", String(item?.holds?.length ?? 0)],
        ]}
      />
      <PillList title="Authors" values={item?.authorIds ?? []} empty="No authors" />
    </ExamplePreviewShell>
  );
}

function CollectionPreview(props: SchematicsPreviewComponentProps<CollectionConfig>) {
  const collection = props.value;
  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="collection" />}
      title={collection?.name ?? "Untitled collection"}
      diagnostics={props.diagnostics.length}
    >
      <PillList title="Items" values={collection?.itemIds ?? []} empty="No items" />
      <Section title="Shelves">
        <PillList title="" values={collection?.shelves ?? []} empty="No shelves" />
      </Section>
    </ExamplePreviewShell>
  );
}
