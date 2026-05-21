import { Schema } from "effect";

export const OnboardedImportManifestSchema = Schema.Struct({
  source: Schema.String,
  customer: Schema.String,
  forms: Schema.optional(
    Schema.Array(
      Schema.Struct({
        workspaceForm: Schema.String,
        sourceFormId: Schema.optional(Schema.String),
        sourceHtml: Schema.optional(Schema.String),
        generatedFormYaml: Schema.optional(Schema.String),
        generatedPdf: Schema.optional(Schema.String),
      }),
    ),
  ),
});

export type OnboardedImportManifest = typeof OnboardedImportManifestSchema.Type;
