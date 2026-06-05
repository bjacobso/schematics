import { Predicate } from "effect";
import type { SchemaAST } from "effect";
import type { RelationAnnotation } from "./types";

export const RelationAnnotationKey = "@schematics/algebra/relation";

export function getRelationAnnotation(ast: SchemaAST.AST): RelationAnnotation | null {
  const value = ast.annotations?.[RelationAnnotationKey];
  return isRelationAnnotation(value) ? value : null;
}

function isRelationAnnotation(value: unknown): value is RelationAnnotation {
  if (!Predicate.isObject(value)) return false;
  if (value["kind"] === "id") {
    return typeof value["type"] === "string";
  }
  if (value["kind"] === "derived-id") {
    return typeof value["type"] === "string" && Array.isArray(value["id"]);
  }
  if (value["kind"] === "ref") {
    return typeof value["target"] === "string";
  }
  return false;
}
