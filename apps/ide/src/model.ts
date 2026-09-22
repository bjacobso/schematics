import {
  ArtifactProjectCapabilitiesSchema,
  SchematicsValidationSummarySchema,
  SourceFileSchema,
} from "@schematics/protocol";
import { Schema } from "effect";

export const Status = Schema.Literals(["Loading", "Ready", "Saving", "Failed"]);
export type Status = typeof Status.Type;

export const Model = Schema.Struct({
  status: Status,
  files: Schema.Array(SourceFileSchema),
  revision: Schema.Number,
  activePath: Schema.String,
  draft: Schema.String,
  savedContent: Schema.String,
  capabilities: Schema.NullOr(ArtifactProjectCapabilitiesSchema),
  validation: SchematicsValidationSummarySchema,
  error: Schema.String,
  announcement: Schema.String,
  mode: Schema.Literals(["light", "dark"]),
});
export type Model = typeof Model.Type;

export const initialModel: Model = {
  status: "Loading",
  files: [],
  revision: 0,
  activePath: "",
  draft: "",
  savedContent: "",
  capabilities: null,
  validation: { valid: true, errorCount: 0, warningCount: 0, infoCount: 0 },
  error: "",
  announcement: "Loading workspace.",
  mode: "light",
};
