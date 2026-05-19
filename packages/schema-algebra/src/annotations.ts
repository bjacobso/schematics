import type { SchemaAST } from "effect";
import type { RelationAnnotation } from "./types";

export const RelationAnnotationKey = "@schema-ide/schema-algebra/relation";

export function getRelationAnnotation(ast: SchemaAST.AST): RelationAnnotation | null {
  const value = ast.annotations?.[RelationAnnotationKey];
  return isRelationAnnotation(value) ? value : null;
}

function isRelationAnnotation(value: unknown): value is RelationAnnotation {
  if (!isRecord(value)) return false;
  if (value["kind"] === "id") {
    return typeof value["type"] === "string";
  }
  if (value["kind"] === "ref") {
    return typeof value["target"] === "string";
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
