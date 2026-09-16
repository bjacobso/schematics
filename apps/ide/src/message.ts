import {
  ArtifactProjectCapabilitiesSchema,
  SchematicsValidationSummarySchema,
  SourceFileSchema,
} from "@schematics/protocol";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";

export const Message = defineMessageUnion({
  CompletedLoad: {
    files: Schema.Array(SourceFileSchema),
    revision: Schema.Number,
    capabilities: Schema.NullOr(ArtifactProjectCapabilitiesSchema),
    validation: SchematicsValidationSummarySchema,
    error: Schema.String,
  },
  SelectedFile: { path: Schema.String },
  ChangedDraft: { value: Schema.String },
  RequestedSave: {},
  CompletedSave: {
    files: Schema.Array(SourceFileSchema),
    revision: Schema.Number,
    validation: SchematicsValidationSummarySchema,
    error: Schema.String,
  },
  ToggledMode: {},
  RequestedReload: {},
});
export type Message = typeof Message.Type;
