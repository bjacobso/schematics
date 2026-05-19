import { Schema } from "effect";
import type { AnySchema, ReflectedSchema } from "./types";

export function reflectEffectSchema({
  id,
  schema,
  match,
}: {
  readonly id: string;
  readonly schema: AnySchema;
  readonly match?: string | undefined;
}): ReflectedSchema {
  return {
    id,
    title: annotationString(schema.ast.annotations?.["title"]),
    description: annotationString(schema.ast.annotations?.["description"]),
    match,
    jsonSchema: safeJsonSchema(schema),
  };
}

export function safeJsonSchema(schema: AnySchema): unknown {
  try {
    return Schema.toJsonSchemaDocument(schema as never).schema;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not generate JSON Schema",
    };
  }
}

function annotationString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
