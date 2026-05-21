import { Schema } from "effect";
import { ValidationSummary } from "./common-toolkit-schemas";

export const PdfRect = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});

export const PdfAnnotationDocument = Schema.Struct({
  formName: Schema.optional(Schema.String),
  pages: Schema.Array(
    Schema.Struct({
      page: Schema.Number,
      width: Schema.optional(Schema.Number),
      height: Schema.optional(Schema.Number),
      annotations: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          type: Schema.Literals(["text", "multiline", "date", "checkbox", "radio", "signature"]),
          label: Schema.String,
          bbox: PdfRect,
          group: Schema.optional(Schema.String),
          value: Schema.optional(Schema.Union([Schema.String, Schema.Boolean])),
          required: Schema.optional(Schema.Boolean),
          confidence: Schema.optional(Schema.Number),
          notes: Schema.optional(Schema.String),
        }),
      ),
    }),
  ),
});

export const PdfFieldType = Schema.Literals([
  "button",
  "checkbox",
  "dropdown",
  "option-list",
  "radio",
  "signature",
  "text",
  "unknown",
]);

export const PdfCoordinateSystem = Schema.Literals(["screenshot-pixels", "pdf-points"]);

export const PdfInspectSuccess = Schema.Struct({
  kind: Schema.Literal("pdf"),
  encoding: Schema.Literals(["base64", "data-url", "binary-string"]),
  byteLength: Schema.Number,
  headerVersion: Schema.Union([Schema.String, Schema.Null]),
  pageCount: Schema.Number,
  pages: Schema.Array(
    Schema.Struct({
      page: Schema.Number,
      width: Schema.Number,
      height: Schema.Number,
      rotation: Schema.Number,
    }),
  ),
  fields: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      type: PdfFieldType,
      required: Schema.Boolean,
      readOnly: Schema.Boolean,
      widgets: Schema.Array(
        Schema.Struct({
          page: Schema.Union([Schema.Number, Schema.Null]),
          rect: PdfRect,
          screenshotRect: Schema.Union([PdfRect, Schema.Null]),
        }),
      ),
    }),
  ),
  hasXFA: Schema.Boolean,
  writtenPath: Schema.optional(Schema.String),
});

export const PdfUpdateFormAnnotationsParameters = Schema.Struct({
  path: Schema.String,
  annotationDoc: PdfAnnotationDocument,
  coordinateSystem: Schema.optional(PdfCoordinateSystem),
  fieldNamePrefix: Schema.optional(Schema.String),
  removeExisting: Schema.optional(Schema.Boolean),
  validate: Schema.optional(Schema.Boolean),
});

export const PdfUpdateFormAnnotationsSuccess = Schema.Struct({
  success: Schema.Boolean,
  path: Schema.String,
  operation: Schema.Literal("pdf_update_form_annotations"),
  coordinateSystem: PdfCoordinateSystem,
  fieldsCreated: Schema.Array(Schema.String),
  fieldsRemoved: Schema.Array(Schema.String),
  pages: Schema.Array(Schema.Number),
  annotationCount: Schema.Number,
  validation: ValidationSummary,
});

export const PdfRenderPageScreenshotSuccess = Schema.Struct({
  page: Schema.Number,
  imagePath: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
  scale: Schema.Number,
  coordinateSystem: Schema.Literal("top-left-pixels"),
});
