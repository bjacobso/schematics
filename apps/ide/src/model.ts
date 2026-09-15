import {
  ArtifactProjectCapabilitiesSchema,
  SchematicsValidationSummarySchema,
  SourceFileSchema,
} from "@schematics/protocol";
import { DeclarationRelease, DeclarationReleaseSummary } from "@schematics/triplex";
import { Schema } from "effect";

export const Status = Schema.Literals(["Loading", "Ready", "Saving", "Publishing", "Failed"]);
export type Status = typeof Status.Type;

export const Panel = Schema.Literals(["Document", "Release", "History"]);
export type Panel = typeof Panel.Type;

export const Model = Schema.Struct({
  status: Status,
  panel: Panel,
  files: Schema.Array(SourceFileSchema),
  revision: Schema.Number,
  activePath: Schema.String,
  draft: Schema.String,
  savedContent: Schema.String,
  capabilities: Schema.NullOr(ArtifactProjectCapabilitiesSchema),
  validation: SchematicsValidationSummarySchema,
  release: Schema.NullOr(DeclarationRelease),
  releaseHistory: Schema.Array(DeclarationReleaseSummary),
  error: Schema.String,
  announcement: Schema.String,
  mode: Schema.Literals(["light", "dark"]),
});
export type Model = typeof Model.Type;

export const initialModel: Model = {
  status: "Loading",
  panel: "Document",
  files: [],
  revision: 0,
  activePath: "",
  draft: "",
  savedContent: "",
  capabilities: null,
  validation: { valid: true, errorCount: 0, warningCount: 0, infoCount: 0 },
  release: null,
  releaseHistory: [],
  error: "",
  announcement: "Loading workspace.",
  mode: "light",
};
