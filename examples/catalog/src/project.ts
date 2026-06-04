import { ArtifactMatcher, ArtifactType } from "@schematics/artifacts";
import { ArtifactProject, Project } from "@schematics/core";
import { validateCatalogWorkspaceValue } from "./diagnostics";
import {
  AuthorConfigSchema,
  BranchConfigSchema,
  CatalogConfigSchema,
  CollectionConfigSchema,
  ItemConfigSchema,
  LoanPolicyConfigSchema,
  ShelfConfigSchema,
  type CatalogWorkspaceValue,
} from "./schema";

/** One YAML-routed artifact type per catalog entity. */
const yamlArtifact = (name: string) =>
  ArtifactType.make(name).match(ArtifactMatcher.extension("yaml"));

/**
 * The schema-routed artifact project: which files map to which entity schema,
 * and how they fold into the workspace value the relation graph is built from.
 * `single` ⇒ one value (the catalog container); `values` ⇒ an array.
 */
export const CatalogArtifactProject = ArtifactProject.make("nyc-library-yaml")
  .files("catalog.yaml", {
    id: "Catalog",
    type: yamlArtifact("catalog.container"),
    schema: CatalogConfigSchema,
    metadata: {
      attributes: {
        schemaId: "Catalog",
        workspaceField: "catalog",
        single: true,
        format: "yaml",
        description: "The library system container",
      },
    },
  })
  .files("branches/*.yaml", {
    id: "Branches",
    type: yamlArtifact("catalog.branch"),
    schema: BranchConfigSchema,
    metadata: {
      attributes: {
        schemaId: "Branches",
        workspaceField: "branches",
        values: true,
        format: "yaml",
        description: "Library branches",
      },
    },
  })
  .files("authors/*.yaml", {
    id: "Authors",
    type: yamlArtifact("catalog.author"),
    schema: AuthorConfigSchema,
    metadata: {
      attributes: {
        schemaId: "Authors",
        workspaceField: "authors",
        values: true,
        format: "yaml",
        description: "Authors referenced by items",
      },
    },
  })
  .files("shelves/*.yaml", {
    id: "Shelves",
    type: yamlArtifact("catalog.shelf"),
    schema: ShelfConfigSchema,
    metadata: {
      attributes: {
        schemaId: "Shelves",
        workspaceField: "shelves",
        values: true,
        format: "yaml",
        description: "Shelf locations referenced by path",
      },
    },
  })
  .files("items/*.yaml", {
    id: "Items",
    type: yamlArtifact("catalog.item"),
    schema: ItemConfigSchema,
    metadata: {
      attributes: {
        schemaId: "Items",
        workspaceField: "items",
        values: true,
        format: "yaml",
        description: "Catalogued works with editions, copies, and holds",
      },
    },
  })
  .files("collections/*.yaml", {
    id: "Collections",
    type: yamlArtifact("catalog.collection"),
    schema: CollectionConfigSchema,
    metadata: {
      attributes: {
        schemaId: "Collections",
        workspaceField: "collections",
        values: true,
        format: "yaml",
        description: "Curated groupings of items",
      },
    },
  })
  .files("policies/*.yaml", {
    id: "LoanPolicies",
    type: yamlArtifact("catalog.loan-policy"),
    schema: LoanPolicyConfigSchema,
    metadata: {
      attributes: {
        schemaId: "LoanPolicies",
        workspaceField: "loanPolicies",
        values: true,
        format: "yaml",
        description: "Lending policies scoped to the catalog",
      },
    },
  });

/** The routed workspace schema (catalog single + entity arrays). */
export const CatalogProjectBaseSchema = Project.fromArtifactProject(CatalogArtifactProject) as any;

/** The full project schema: routed shape + cross-file relation diagnostics. */
export const CatalogProjectSchema = CatalogProjectBaseSchema.pipe(
  Project.validate<CatalogWorkspaceValue>(
    "catalog workspace references resolve",
    (workspace, issue, context) => {
      for (const diagnostic of validateCatalogWorkspaceValue(workspace, context.files)) {
        issue.at(diagnostic.documentPath ?? "catalog", diagnostic.message, diagnostic.path);
      }
    },
  ),
);
