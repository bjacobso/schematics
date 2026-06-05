import { Relation } from "@schematics/algebra";
import { Schema } from "effect";

/**
 * A public-library catalog modeled top-to-bottom with `@schematics/algebra`.
 *
 * This example is deliberately a *complete* tour of the relation algebra — every
 * combinator and option appears at least once, and they all resolve against each
 * other so validation, diff, and the graph views are meaningful:
 *
 * | Algebra ability            | Where it shows up                              |
 * | -------------------------- | ---------------------------------------------- |
 * | `id` + `display`           | every entity (`catalog`, `branch`, …)          |
 * | `ref` (single, id)         | `item.homeBranchId → branch`                   |
 * | `refs` (array) + `edge`    | `item.authorIds → author`, edge `authoredBy`   |
 * | `pathRef` (single, path)   | `loanPolicy.primaryShelf → shelf`              |
 * | `pathRefs` (array, path)   | `collection.shelves → shelf`                   |
 * | `derivedId`                | `edition` id derived from its `isbn` field     |
 * | `parent` scope             | `copy.barcode` scoped to its enclosing `item`  |
 * | `path` scope               | `loanPolicy` ids scoped to the `catalog` id    |
 * | `scopedBy` (on a ref)      | `hold.copy → copy`, scoped by the item id      |
 *
 * The graph/validate/inspect helpers (`buildRelationGraph`, `validateRelations`,
 * `buildEntityIndex`, `validateRelationReferences`, `definitionLocations`,
 * `references`, `referenceDiagnostics`, `patchSuggestions`, `Relation.key`) are
 * exercised in `./diagnostics` and `./project`.
 */

export const CATALOG_KIND = "catalog";
export const BRANCH_KIND = "branch";
export const AUTHOR_KIND = "author";
export const SHELF_KIND = "shelf";
export const ITEM_KIND = "item";
export const EDITION_KIND = "edition";
export const COPY_KIND = "copy";
export const COLLECTION_KIND = "collection";
export const LOAN_POLICY_KIND = "loanPolicy";

// ── leaf entities ─────────────────────────────────────────────────────────────

/** The single account-level container; its id anchors `path`-scoped policies. */
export const CatalogConfigSchema = Schema.Struct({
  id: Relation.id(CATALOG_KIND, { display: "name" }),
  name: Schema.String,
  system: Schema.optional(Schema.String),
});
export type CatalogConfig = typeof CatalogConfigSchema.Type;

/** A physical library branch — the target of single `ref`s from items. */
export const BranchConfigSchema = Schema.Struct({
  id: Relation.id(BRANCH_KIND, { display: "name" }),
  name: Schema.String,
  address: Schema.optional(Schema.String),
});
export type BranchConfig = typeof BranchConfigSchema.Type;

/** An author — the target of `edge`-typed `refs` arrays from items. */
export const AuthorConfigSchema = Schema.Struct({
  id: Relation.id(AUTHOR_KIND, { display: "name" }),
  name: Schema.String,
});
export type AuthorConfig = typeof AuthorConfigSchema.Type;

/**
 * A shelf location in the branch layout. Its `id` is path-like (e.g.
 * `fiction/a-f`), so it is referenced via `pathRef`/`pathRefs` rather than a
 * plain id ref.
 */
export const ShelfConfigSchema = Schema.Struct({
  id: Relation.id(SHELF_KIND, { display: "label" }),
  label: Schema.String,
});
export type ShelfConfig = typeof ShelfConfigSchema.Type;

// ── item + its nested, scoped children ────────────────────────────────────────

/**
 * An edition of a work. The edition id is *derived* from its `isbn` field rather
 * than a separate id property, and its human label comes from `label`.
 */
export const EditionConfigSchema = Relation.derivedId(
  Schema.Struct({
    isbn: Schema.String,
    label: Schema.String,
    year: Schema.optional(Schema.Number),
  }),
  EDITION_KIND,
  { id: "isbn", display: "label" },
);
export type EditionConfig = typeof EditionConfigSchema.Type;

/**
 * A physical copy. Its `barcode` is an id *scoped to the enclosing item* via the
 * `parent` scope builder, so the same barcode space can repeat across items, and
 * it points at a shelf via a single `pathRef`.
 */
export const CopyConfigSchema = Schema.Struct({
  barcode: Relation.id(COPY_KIND, { scope: Relation.parent(ITEM_KIND), display: "barcode" }),
  shelf: Relation.pathRef(SHELF_KIND),
  condition: Schema.optional(Schema.Literals(["new", "good", "worn"])),
});
export type CopyConfig = typeof CopyConfigSchema.Type;

/**
 * A patron hold on a specific copy of the item. The `copy` reference is *scoped
 * by the item id* (`scopedBy: ["..","id"]`, walking one object up to the item),
 * so it resolves against the item-scoped copy definitions above.
 */
export const HoldConfigSchema = Schema.Struct({
  patron: Schema.String,
  copy: Relation.ref(COPY_KIND, { scopedBy: ["..", "id"] }),
});
export type HoldConfig = typeof HoldConfigSchema.Type;

/** A catalogued work, owning its editions, copies, and holds. */
export const ItemConfigSchema = Schema.Struct({
  id: Relation.id(ITEM_KIND, { display: "title" }),
  title: Schema.String,
  // single id ref → branch
  homeBranchId: Relation.ref(BRANCH_KIND),
  // array of id refs → authors, tagged with a typed edge
  authorIds: Relation.refs(AUTHOR_KIND, { edge: "authoredBy" }),
  editions: Schema.Array(EditionConfigSchema),
  copies: Schema.optional(Schema.Array(CopyConfigSchema)),
  holds: Schema.optional(Schema.Array(HoldConfigSchema)),
});
export type ItemConfig = typeof ItemConfigSchema.Type;

// ── collection + loan policy ──────────────────────────────────────────────────

/** A curated grouping: id refs to items + path refs to the shelves it occupies. */
export const CollectionConfigSchema = Schema.Struct({
  id: Relation.id(COLLECTION_KIND, { display: "name" }),
  name: Schema.String,
  itemIds: Relation.refs(ITEM_KIND, { edge: "includes" }),
  shelves: Schema.optional(Relation.pathRefs(SHELF_KIND)),
});
export type CollectionConfig = typeof CollectionConfigSchema.Type;

/**
 * A lending policy. Policy ids are scoped to the catalog via the `path` scope
 * builder (`["catalog","id"]` resolved against the workspace root), and the
 * policy points at a primary shelf via a single `pathRef`.
 */
export const LoanPolicyConfigSchema = Schema.Struct({
  id: Relation.id(LOAN_POLICY_KIND, {
    scope: Relation.path(["catalog", "id"]),
    display: "name",
  }),
  name: Schema.String,
  loanDays: Schema.Number,
  primaryShelf: Schema.optional(Relation.pathRef(SHELF_KIND)),
});
export type LoanPolicyConfig = typeof LoanPolicyConfigSchema.Type;

// ── workspace ─────────────────────────────────────────────────────────────────

/**
 * The whole-catalog value the relation graph is built from. The graph traversal
 * needs this single rooted schema so `path`/`parent`/`scopedBy` scopes resolve
 * across files.
 */
export const CatalogWorkspaceSchema = Schema.Struct({
  catalog: Schema.NullOr(CatalogConfigSchema),
  branches: Schema.Array(BranchConfigSchema),
  authors: Schema.Array(AuthorConfigSchema),
  shelves: Schema.Array(ShelfConfigSchema),
  items: Schema.Array(ItemConfigSchema),
  collections: Schema.Array(CollectionConfigSchema),
  loanPolicies: Schema.Array(LoanPolicyConfigSchema),
});
export type CatalogWorkspaceValue = typeof CatalogWorkspaceSchema.Type;
