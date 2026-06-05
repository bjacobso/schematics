import { CatalogArtifactProject } from "@schematics/example-catalog";
import { ArtifactProjectPreview } from "@schematics/ide";
import {
  AuthorPreview,
  BranchPreview,
  CatalogPreview,
  CollectionPreview,
  ItemPreview,
  LoanPolicyPreview,
  ShelfPreview,
} from "./preview/components";

// One read-only, patron-facing preview per resource type. Updates are made
// elsewhere (via agents); these components only *visualize* the resource so a
// non-technical reader can understand the catalogue at a glance.
export const nycLibraryPreviews = ArtifactProjectPreview.make(CatalogArtifactProject, [
  { id: "nyc-library-catalog", schemaId: "Catalog", label: "Library", component: CatalogPreview },
  { id: "nyc-library-branch", schemaId: "Branches", label: "Branch", component: BranchPreview },
  { id: "nyc-library-author", schemaId: "Authors", label: "Author", component: AuthorPreview },
  { id: "nyc-library-shelf", schemaId: "Shelves", label: "Shelf", component: ShelfPreview },
  { id: "nyc-library-item", schemaId: "Items", label: "Item", component: ItemPreview },
  {
    id: "nyc-library-collection",
    schemaId: "Collections",
    label: "Collection",
    component: CollectionPreview,
  },
  {
    id: "nyc-library-policy",
    schemaId: "LoanPolicies",
    label: "Loan policy",
    component: LoanPolicyPreview,
  },
]);
