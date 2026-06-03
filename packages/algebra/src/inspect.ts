import type {
  RelationDefinition,
  RelationDiagnostic,
  RelationEntityIndex,
  RelationEntityIndexEntry,
  RelationGraph,
  RelationPatchSuggestion,
  RelationReference,
} from "./types";

export function buildEntityIndex(graph: RelationGraph): RelationEntityIndex {
  const entries = new Map<string, RelationEntityIndexEntry>();

  for (const definition of graph.definitions) {
    const key = relationKey(definition.type, definition.id, definition.scope);
    const existing = entries.get(key);
    if (existing) {
      entries.set(key, {
        ...existing,
        definitions: [...existing.definitions, definition],
      });
      continue;
    }

    entries.set(key, {
      type: definition.type,
      id: definition.id,
      scope: definition.scope,
      definitions: [definition],
    });
  }

  return [...entries.values()];
}

export function definitionLocations(graph: RelationGraph): readonly RelationDefinition[] {
  return graph.definitions;
}

export function references(graph: RelationGraph): readonly RelationReference[] {
  return graph.references;
}

export function referenceDiagnostics(
  diagnostics: readonly RelationDiagnostic[],
): readonly RelationDiagnostic[] {
  return diagnostics.filter((diagnostic) => {
    if (diagnostic.code === "unresolved-ref") return true;
    return diagnostic.code === "invalid-relation-value" && "target" in diagnostic.relation;
  });
}

export function patchSuggestions(
  diagnostics: readonly RelationDiagnostic[],
): readonly RelationPatchSuggestion[] {
  return diagnostics.flatMap((diagnostic) => {
    if (diagnostic.code !== "unresolved-ref" || !("target" in diagnostic.relation)) return [];
    const reference = diagnostic.relation;
    return [
      {
        kind: "create-definition",
        target: reference.target,
        id: reference.id,
        path: diagnostic.path,
        message: `Create ${reference.target} "${reference.id}"`,
        ...(reference.scope ? { scope: reference.scope } : {}),
        reference,
      },
    ];
  });
}

function relationKey(type: string, id: string, scope: string | undefined): string {
  return `${type}\u0000${scope ?? ""}\u0000${id}`;
}
