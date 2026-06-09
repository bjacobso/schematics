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
  type RelationDefinition,
  type RelationDiagnostic,
  type RelationEntityIndex,
  type RelationGraph,
  type RelationPatchSuggestion,
  type RelationReference,
} from "@schematics/algebra";
import type { SchematicsDiagnostic, SourceFile } from "@schematics/core";
import { deriveWorkspaceDiagnostics } from "@schematics/provider";
import { catalogResources } from "./resources";
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

// Cross-file workspace diagnostics (duplicate ids + unresolved refs), derived
// from the resource set via the provider DSL — friendly messages + a
// kind→document-path map fall out of the resources, so there's no bespoke
// mapping here.
const diagnoseCatalogWorkspace = deriveWorkspaceDiagnostics(CatalogWorkspaceSchema, catalogResources, {
  fallbackDocument: "catalog",
});

export function validateCatalogWorkspaceValue(
  workspace: CatalogWorkspaceValue,
  _files: readonly SourceFile[] = [],
): readonly SchematicsDiagnostic[] {
  return diagnoseCatalogWorkspace(workspace);
}

/** Re-exported so consumers can read a relation annotation off a schema field. */
export { getRelationAnnotation };
