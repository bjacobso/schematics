import {
  buildEntityIndex,
  buildRelationGraph,
  definitionLocations,
  getRelationAnnotation,
  patchSuggestions,
  referenceDiagnostics,
  references,
  validateRelationReferences,
  validateRelations,
  Relation,
  type RelationDefinition,
  type RelationDiagnostic,
  type RelationEntityIndex,
  type RelationGraph,
  type RelationPatchSuggestion,
  type RelationReference,
} from "@schematics/algebra";
import type { SchematicsDiagnostic, SourceFile } from "@schematics/core";
import { CatalogWorkspaceSchema, type CatalogWorkspaceValue } from "./schema";

/**
 * Every algebra inspection in one place — this is the example's tour of the
 * graph/validate/inspect surface. The IDE "algebra views" and the CLI `inspect`
 * command render this, and the workspace validator below reuses it.
 */
export interface CatalogRelationReport {
  readonly graph: RelationGraph;
  readonly entityIndex: RelationEntityIndex;
  readonly definitions: readonly RelationDefinition[];
  readonly references: readonly RelationReference[];
  readonly diagnostics: readonly RelationDiagnostic[];
  readonly referenceDiagnostics: readonly RelationDiagnostic[];
  readonly patchSuggestions: readonly RelationPatchSuggestion[];
}

export function inspectCatalogRelations(workspace: CatalogWorkspaceValue): CatalogRelationReport {
  const graph = buildRelationGraph(CatalogWorkspaceSchema, workspace);
  const entityIndex = buildEntityIndex(graph);
  const allDiagnostics = validateRelations(CatalogWorkspaceSchema, workspace);
  // Re-check the extracted references against the entity index with the lower
  // level API too, demonstrating `validateRelationReferences` independently of
  // the all-in-one `validateRelations`.
  const extracted = references(graph);
  const refDiagnostics = validateRelationReferences(entityIndex, extracted);
  return {
    graph,
    entityIndex,
    definitions: definitionLocations(graph),
    references: extracted,
    diagnostics: allDiagnostics,
    referenceDiagnostics: [
      ...referenceDiagnostics(allDiagnostics),
      ...referenceDiagnostics(refDiagnostics),
    ],
    patchSuggestions: patchSuggestions(allDiagnostics),
  };
}

/**
 * Cross-file workspace diagnostics: duplicate ids and unresolved references
 * surfaced from the annotated relation schema, with catalog-friendly messages.
 */
export function validateCatalogWorkspaceValue(
  workspace: CatalogWorkspaceValue,
  _files: readonly SourceFile[] = [],
): readonly SchematicsDiagnostic[] {
  const diagnostics: SchematicsDiagnostic[] = [];
  for (const diagnostic of validateRelations(CatalogWorkspaceSchema, workspace)) {
    diagnostics.push({
      // `Relation.key` normalizes the path tuple the same way the combinators do.
      path: diagnostic.path.length > 0 ? Relation.key(diagnostic.path).join(".") : null,
      documentPath: documentPathFor(diagnostic),
      severity: diagnostic.severity === "warning" ? "warning" : "error",
      source: "cross-file",
      message: friendlyMessage(diagnostic),
    });
  }
  return diagnostics;
}

function friendlyMessage(diagnostic: RelationDiagnostic): string {
  const relation = diagnostic.relation;
  if (diagnostic.code === "unresolved-ref" && "target" in relation) {
    return `Unknown ${relation.target}: ${relation.id}`;
  }
  if (diagnostic.code === "duplicate-id" && "type" in relation) {
    return `Duplicate ${relation.type} id: ${relation.id}`;
  }
  return diagnostic.message;
}

function documentPathFor(diagnostic: RelationDiagnostic): string {
  const relation = diagnostic.relation;
  const kind = "target" in relation ? relation.target : relation.type;
  const field = DOCUMENT_FIELDS[kind];
  if (field && "id" in relation) return `${field}.${relation.id}`;
  return diagnostic.path.length > 0 ? diagnostic.path.join(".") : "catalog";
}

const DOCUMENT_FIELDS: Record<string, string | undefined> = {
  catalog: "catalog",
  branch: "branches",
  author: "authors",
  shelf: "shelves",
  item: "items",
  collection: "collections",
  loanPolicy: "loanPolicies",
};

/** Re-exported so consumers can read a relation annotation off a schema field. */
export { getRelationAnnotation };
