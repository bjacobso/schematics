import { Schema } from "effect";
import { ValidationSummary } from "./common-toolkit-schemas";

export const JsonPatchOperation = Schema.Struct({
  op: Schema.Literals(["add", "replace", "remove"]),
  path: Schema.String,
  value: Schema.optional(Schema.Unknown),
});
export type JsonPatchOperationInput = typeof JsonPatchOperation.Type;

export const JsonPatchParameters = Schema.Struct({
  path: Schema.String,
  patch: Schema.Array(JsonPatchOperation),
  validate: Schema.optional(Schema.Boolean),
});

export const JsonPatchSuccess = Schema.Struct({
  success: Schema.Boolean,
  path: Schema.String,
  value: Schema.Unknown,
  validation: ValidationSummary,
});
