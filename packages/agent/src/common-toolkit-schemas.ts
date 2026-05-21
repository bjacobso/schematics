import { Schema } from "effect";

export const ToolFailure = Schema.Struct({
  error: Schema.String,
});
export type SchemaIdeToolFailure = typeof ToolFailure.Type;

export const ValidationSummary = Schema.Struct({
  valid: Schema.Boolean,
  errorCount: Schema.Number,
  warningCount: Schema.Number,
  infoCount: Schema.Number,
});
