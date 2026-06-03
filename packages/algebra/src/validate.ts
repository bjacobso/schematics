import { collectRelationGraph } from "./graph";
import type { AnySchema, RelationDefinition, RelationDiagnostic, RelationReference } from "./types";

export function validateRelations(
  schema: AnySchema,
  value: unknown,
): readonly RelationDiagnostic[] {
  const graph = collectRelationGraph(schema, value);
  const diagnostics: RelationDiagnostic[] = [...graph.invalid];
  const definitionsByKey = new Map<string, RelationDefinition[]>();

  for (const definition of graph.definitions) {
    const key = relationKey(definition.type, definition.id, definition.scope);
    const existing = definitionsByKey.get(key);
    if (existing) {
      existing.push(definition);
    } else {
      definitionsByKey.set(key, [definition]);
    }
  }

  for (const duplicates of definitionsByKey.values()) {
    if (duplicates.length < 2) continue;
    for (const definition of duplicates) {
      diagnostics.push({
        severity: "error",
        code: "duplicate-id",
        path: definition.path,
        message: `Duplicate ${definition.type} id "${definition.id}"${definition.scope ? ` in scope "${definition.scope}"` : ""}`,
        relation: definition,
      });
    }
  }

  for (const reference of graph.references) {
    if (!definitionsByKey.has(relationKey(reference.target, reference.id, reference.scope))) {
      diagnostics.push(unresolvedDiagnostic(reference));
    }
  }

  return diagnostics;
}

function unresolvedDiagnostic(reference: RelationReference): RelationDiagnostic {
  return {
    severity: "error",
    code: "unresolved-ref",
    path: reference.path,
    message: `Unresolved ${reference.target} reference "${reference.id}"${reference.scope ? ` in scope "${reference.scope}"` : ""}`,
    relation: reference,
  };
}

function relationKey(type: string, id: string, scope: string | undefined): string {
  return `${type}\u0000${scope ?? ""}\u0000${id}`;
}
