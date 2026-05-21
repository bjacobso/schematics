import { Schema } from "effect";
import { ValidationSummary } from "./common-toolkit-schemas";

export const MutationResult = Schema.Struct({
  success: Schema.Boolean,
  path: Schema.String,
  validation: ValidationSummary,
});

export const FileEdit = Schema.Struct({
  path: Schema.String.annotate({ description: "Workspace path to write." }),
  content: Schema.String.annotate({ description: "Complete file content after the edit." }),
  create: Schema.optional(
    Schema.Boolean.annotate({
      description: "When true, the path must not exist before the edit.",
    }),
  ),
});

export const MultiEditResult = Schema.Struct({
  success: Schema.Boolean,
  changedPaths: Schema.Array(Schema.String),
  validation: ValidationSummary,
});
