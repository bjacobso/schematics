import { SchemaAST } from "effect";
import { getRelationAnnotation } from "./annotations";
import type {
  AnySchema,
  RelationAnnotation,
  RelationDefinition,
  RelationDiagnostic,
  RelationGraph,
  RelationReference,
  RelationScope,
} from "./types";

interface GraphState {
  readonly definitions: RelationDefinition[];
  readonly references: RelationReference[];
  readonly invalid: RelationDiagnostic[];
}

interface TraversalContext {
  readonly root: unknown;
  readonly nearestObject: Record<string, unknown> | null;
  readonly definitionStack: readonly RelationDefinition[];
}

export function buildRelationGraph(schema: AnySchema, value: unknown): RelationGraph {
  const state = collectRelationGraph(schema, value);
  return {
    definitions: state.definitions,
    references: state.references,
  };
}

export function collectRelationGraph(schema: AnySchema, value: unknown): GraphState {
  const state: GraphState = { definitions: [], references: [], invalid: [] };
  visit(
    schema.ast,
    value,
    [],
    {
      root: value,
      nearestObject: isRecord(value) ? value : null,
      definitionStack: [],
    },
    state,
  );
  return state;
}

function visit(
  ast: SchemaAST.AST,
  value: unknown,
  path: readonly string[],
  context: TraversalContext,
  state: GraphState,
  options: { readonly suppressCurrentId?: boolean | undefined } = {},
): void {
  const annotation = getRelationAnnotation(ast);
  if (annotation && !(annotation.kind === "id" && options.suppressCurrentId)) {
    collectRelation(annotation, value, path, context, state);
  }

  if (SchemaAST.isRefinement(ast)) {
    visit(ast.from, value, path, context, state, options);
    return;
  }

  if (SchemaAST.isTransformation(ast)) {
    visit(ast.to, value, path, context, state, options);
    return;
  }

  if (SchemaAST.isSuspend(ast)) {
    visit(ast.f(), value, path, context, state, options);
    return;
  }

  if (SchemaAST.isUnion(ast)) {
    for (const member of ast.types) {
      visit(member, value, path, context, state, options);
    }
    return;
  }

  if (SchemaAST.isTupleType(ast)) {
    visitTuple(ast, value, path, context, state);
    return;
  }

  if (SchemaAST.isTypeLiteral(ast)) {
    visitTypeLiteral(ast, value, path, context, state);
  }
}

function visitTuple(
  ast: SchemaAST.TupleType,
  value: unknown,
  path: readonly string[],
  context: TraversalContext,
  state: GraphState,
): void {
  if (!Array.isArray(value)) return;

  ast.elements.forEach((element, index) => {
    visit(element.type, value[index], [...path, String(index)], context, state);
  });

  const rest = ast.rest[0];
  if (!rest) return;

  for (let index = ast.elements.length; index < value.length; index += 1) {
    visit(rest.type, value[index], [...path, String(index)], context, state);
  }
}

function visitTypeLiteral(
  ast: SchemaAST.TypeLiteral,
  value: unknown,
  path: readonly string[],
  context: TraversalContext,
  state: GraphState,
): void {
  if (!isRecord(value)) return;

  const localDefinitions = collectLocalDefinitions(ast, value, path, context, state);
  const childContext: TraversalContext = {
    ...context,
    nearestObject: value,
    definitionStack: [...context.definitionStack, ...localDefinitions],
  };
  const suppressedIdProperties = new Set(
    localDefinitions.map((definition) => definition.path[definition.path.length - 1]),
  );

  for (const property of ast.propertySignatures) {
    if (typeof property.name !== "string") continue;
    visit(property.type, value[property.name], [...path, property.name], childContext, state, {
      suppressCurrentId: suppressedIdProperties.has(property.name),
    });
  }
}

function collectLocalDefinitions(
  ast: SchemaAST.TypeLiteral,
  value: Record<string, unknown>,
  path: readonly string[],
  context: TraversalContext,
  state: GraphState,
): readonly RelationDefinition[] {
  const definitions: RelationDefinition[] = [];

  for (const property of ast.propertySignatures) {
    if (typeof property.name !== "string") continue;
    const annotation = getRelationAnnotation(property.type);
    if (annotation?.kind !== "id") continue;

    const propertyPath = [...path, property.name];
    const propertyValue = value[property.name];
    if (typeof propertyValue !== "string") {
      state.invalid.push(invalidDiagnostic(propertyPath, annotation, propertyValue));
      continue;
    }

    const definition = definitionFromAnnotation(
      annotation,
      propertyValue,
      propertyPath,
      context,
      value,
    );
    definitions.push(definition);
    state.definitions.push(definition);
  }

  return definitions;
}

function collectRelation(
  annotation: RelationAnnotation,
  value: unknown,
  path: readonly string[],
  context: TraversalContext,
  state: GraphState,
): void {
  if (typeof value !== "string") {
    state.invalid.push(invalidDiagnostic(path, annotation, value));
    return;
  }

  if (annotation.kind === "id") {
    state.definitions.push(definitionFromAnnotation(annotation, value, path, context, null));
  } else {
    state.references.push({
      target: annotation.target,
      id: value,
      path,
      scope: resolveRefScope(annotation.scope, annotation.scopedBy, context),
      scopedBy: annotation.scopedBy,
    });
  }
}

function definitionFromAnnotation(
  annotation: Extract<RelationAnnotation, { readonly kind: "id" }>,
  id: string,
  path: readonly string[],
  context: TraversalContext,
  objectValue: Record<string, unknown> | null,
): RelationDefinition {
  return {
    type: annotation.type,
    id,
    path,
    scope: annotation.scope ? resolveScope(annotation.scope, context) : undefined,
    display:
      annotation.display && objectValue ? displayValue(objectValue, annotation.display) : undefined,
  };
}

function resolveRefScope(
  explicitScope: RelationScope | undefined,
  scopedBy: readonly string[] | undefined,
  context: TraversalContext,
): string | undefined {
  if (scopedBy) {
    const value = context.nearestObject ? getAtPath(context.nearestObject, scopedBy) : undefined;
    return typeof value === "string" ? value : undefined;
  }
  return explicitScope ? resolveScope(explicitScope, context) : undefined;
}

function resolveScope(scope: RelationScope, context: TraversalContext): string | undefined {
  if (scope.kind === "path") {
    const value = getAtPath(context.root, scope.path);
    return typeof value === "string" ? value : undefined;
  }

  const parent = [...context.definitionStack]
    .reverse()
    .find((definition) => definition.type === scope.type);
  return parent?.id;
}

function invalidDiagnostic(
  path: readonly string[],
  annotation: RelationAnnotation,
  value: unknown,
): RelationDiagnostic {
  const relation =
    annotation.kind === "id"
      ? {
          type: annotation.type,
          id: String(value),
          path,
          scope: undefined,
          display: undefined,
        }
      : {
          target: annotation.target,
          id: String(value),
          path,
          scope: undefined,
          scopedBy: annotation.scopedBy,
        };

  return {
    severity: "error",
    code: "invalid-relation-value",
    path,
    message: `Relation ${annotation.kind} at ${formatPath(path)} must be a string`,
    relation,
  };
}

function displayValue(value: Record<string, unknown>, path: readonly string[]): string | undefined {
  const display = getAtPath(value, path);
  return typeof display === "string" ? display : undefined;
}

function getAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current) && !Array.isArray(current)) return undefined;
    current = current[segment as keyof typeof current];
  }
  return current;
}

function formatPath(path: readonly string[]): string {
  return path.length ? path.join(".") : "<root>";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
