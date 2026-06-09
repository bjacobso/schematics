import { defineResource } from "@schematics/provider";
import {
  AUTHOR_KIND,
  AuthorConfigSchema,
  BRANCH_KIND,
  BranchConfigSchema,
  CATALOG_KIND,
  CatalogConfigSchema,
  COLLECTION_KIND,
  CollectionConfigSchema,
  ITEM_KIND,
  ItemConfigSchema,
  LOAN_POLICY_KIND,
  LoanPolicyConfigSchema,
  SHELF_KIND,
  ShelfConfigSchema,
} from "./schema";

/**
 * The catalog as a set of provider resources — one declaration per top-level
 * entity, carrying both the schema-side fields (route/schema, for the artifact
 * project + relation validation) and the deploy-side identity. The mock/live
 * transport is keyed by `remoteKey` (= workspaceField), so its segments
 * (`branches`, `authors`, …, `catalog`) line up automatically.
 *
 * Editions/Copies/Holds are NOT resources — they live nested inside
 * `ItemConfigSchema`, so they ride along in the `items` field and the relation
 * algebra validates them without their own route. The catalog container is
 * read-only via config-as-code.
 */
export const catalogResources = [
  defineResource<typeof CatalogConfigSchema.Type>({
    kind: CATALOG_KIND,
    schemaId: "Catalog",
    schema: CatalogConfigSchema,
    single: true,
    route: "catalog.yaml",
    writeOps: "read-only",
    description: "The library system container",
  }),
  defineResource<typeof BranchConfigSchema.Type>({
    kind: BRANCH_KIND,
    schemaId: "Branches",
    schema: BranchConfigSchema,
    description: "Library branches",
  }),
  defineResource<typeof AuthorConfigSchema.Type>({
    kind: AUTHOR_KIND,
    schemaId: "Authors",
    schema: AuthorConfigSchema,
    description: "Authors referenced by items",
  }),
  defineResource<typeof ShelfConfigSchema.Type>({
    kind: SHELF_KIND,
    schemaId: "Shelves",
    schema: ShelfConfigSchema,
    description: "Shelf locations referenced by path",
  }),
  defineResource<typeof ItemConfigSchema.Type>({
    kind: ITEM_KIND,
    schemaId: "Items",
    schema: ItemConfigSchema,
    description: "Catalogued works with editions, copies, and holds",
  }),
  defineResource<typeof CollectionConfigSchema.Type>({
    kind: COLLECTION_KIND,
    schemaId: "Collections",
    schema: CollectionConfigSchema,
    description: "Curated groupings of items",
  }),
  defineResource<typeof LoanPolicyConfigSchema.Type>({
    kind: LOAN_POLICY_KIND,
    schemaId: "LoanPolicies",
    schema: LoanPolicyConfigSchema,
    route: "policies/*.yaml",
    description: "Lending policies scoped to the catalog",
  }),
];
