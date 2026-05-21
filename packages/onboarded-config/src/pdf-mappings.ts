import { Schema } from "effect";
import { Relation } from "@schema-ide/schema-algebra";
import type {
  DocumentFileEntry,
  OnboardedDocumentConfig,
  OnboardedPdfInspect,
  PdfRect,
} from "./documents";
import { inspectForDocument } from "./documents";
import type { WorkspaceIssue } from "./common";

const PdfAnnotationMappingSchema = Schema.Struct({
  page: Schema.Number,
  type: Schema.Literals(["text", "multiline", "date", "checkbox", "radio", "signature"]),
  bbox: Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    width: Schema.Number,
    height: Schema.Number,
  }),
  label: Schema.optional(Schema.String),
});

const PdfMappingEntrySchema = Schema.Struct({
  formField: Relation.pathRef("FormField", {
    scopedBy: "../form",
    edge: "maps_form_field",
  }),
  pdfField: Schema.optional(
    Relation.pathRef("PdfField", {
      scopedBy: "../document",
      edge: "maps_pdf_field",
    }),
  ),
  annotationId: Schema.optional(
    Relation.ref("PdfAnnotation", {
      scopedBy: "../document",
      edge: "maps_pdf_annotation",
    }),
  ),
  annotation: Schema.optional(PdfAnnotationMappingSchema),
  direction: Schema.optional(Schema.Literals(["onboarded_to_pdf", "pdf_to_onboarded", "both"])),
  transform: Schema.optional(Schema.String),
});
export type OnboardedPdfMappingEntry = typeof PdfMappingEntrySchema.Type;

export const OnboardedPdfMappingConfigSchema = Schema.Struct({
  id: Relation.id("PdfMapping"),
  form: Relation.ref("Form", { edge: "maps_form" }),
  document: Relation.ref("Document", { edge: "maps_document" }),
  coordinateSystem: Schema.optional(Schema.Literals(["pdf-points", "screenshot-pixels"])),
  mappings: Schema.Array(PdfMappingEntrySchema),
});
export type OnboardedPdfMappingConfig = typeof OnboardedPdfMappingConfigSchema.Type;

export function validatePdfMapping(
  mapping: OnboardedPdfMappingConfig,
  documents: ReadonlyMap<string, DocumentFileEntry<OnboardedDocumentConfig>>,
  inspections: ReadonlyMap<string, OnboardedPdfInspect>,
  issue: WorkspaceIssue,
) {
  const document = documents.get(mapping.document);
  const inspect = document ? inspectForDocument(document, inspections) : null;
  const pageByNumber = new Map((inspect?.pages ?? []).map((page) => [page.page, page]));

  for (const entry of mapping.mappings) {
    if (!entry.pdfField && !entry.annotation && !entry.annotationId) {
      issue.at(
        `pdfMappings.${mapping.id}.mappings`,
        `Mapping for ${entry.formField} must define pdfField, annotation, or annotationId`,
      );
    }

    if (entry.annotation && inspect) {
      validateAnnotationBounds(
        mapping.id,
        entry.annotation.page,
        entry.annotation.bbox,
        pageByNumber,
        issue,
      );
    }
  }
}

function validateAnnotationBounds(
  mappingId: string,
  pageNumber: number,
  bbox: PdfRect,
  pages: ReadonlyMap<number, { readonly width: number; readonly height: number }>,
  issue: WorkspaceIssue,
) {
  const page = pages.get(pageNumber);
  if (!page) {
    issue.at(`pdfMappings.${mappingId}.mappings`, `Unknown PDF page: ${pageNumber}`);
    return;
  }

  const outsidePage =
    bbox.x < 0 ||
    bbox.y < 0 ||
    bbox.width <= 0 ||
    bbox.height <= 0 ||
    bbox.x + bbox.width > page.width ||
    bbox.y + bbox.height > page.height;

  if (outsidePage) {
    issue.at(
      `pdfMappings.${mappingId}.mappings`,
      `PDF annotation bbox is outside page ${pageNumber}`,
    );
  }
}
