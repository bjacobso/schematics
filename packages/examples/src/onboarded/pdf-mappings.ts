import { Schema } from "effect";
import type { OnboardedFormConfig } from "./forms";
import type {
  DocumentFileEntry,
  OnboardedDocumentConfig,
  OnboardedPdfAnnotationDocument,
  OnboardedPdfInspect,
  PdfRect,
} from "./documents";
import { annotationsForDocument, inspectForDocument } from "./documents";
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
  formField: Schema.String,
  pdfField: Schema.optional(Schema.String),
  annotationId: Schema.optional(Schema.String),
  annotation: Schema.optional(PdfAnnotationMappingSchema),
  direction: Schema.optional(Schema.Literals(["onboarded_to_pdf", "pdf_to_onboarded", "both"])),
  transform: Schema.optional(Schema.String),
});
export type OnboardedPdfMappingEntry = typeof PdfMappingEntrySchema.Type;

export const OnboardedPdfMappingConfigSchema = Schema.Struct({
  id: Schema.String,
  form: Schema.String,
  document: Schema.String,
  coordinateSystem: Schema.optional(Schema.Literals(["pdf-points", "screenshot-pixels"])),
  mappings: Schema.Array(PdfMappingEntrySchema),
});
export type OnboardedPdfMappingConfig = typeof OnboardedPdfMappingConfigSchema.Type;

export function validatePdfMapping(
  mapping: OnboardedPdfMappingConfig,
  forms: ReadonlyMap<string, OnboardedFormConfig>,
  documents: ReadonlyMap<string, DocumentFileEntry<OnboardedDocumentConfig>>,
  inspections: ReadonlyMap<string, OnboardedPdfInspect>,
  annotations: ReadonlyMap<string, OnboardedPdfAnnotationDocument>,
  issue: WorkspaceIssue,
) {
  const form = forms.get(mapping.form);
  const document = documents.get(mapping.document);

  if (!form) {
    issue.at(`pdfMappings.${mapping.id}.form`, `Unknown form: ${mapping.form}`);
  }
  if (!document) {
    issue.at(`pdfMappings.${mapping.id}.document`, `Unknown document: ${mapping.document}`);
  }

  const formFields = new Set(form ? collectFormFieldPaths(form) : []);
  const inspect = document ? inspectForDocument(document, inspections) : null;
  const annotationDoc = document ? annotationsForDocument(document, annotations) : null;
  const pdfFields = new Map((inspect?.fields ?? []).map((field) => [field.name, field]));
  const annotationIds = new Set(
    (annotationDoc?.pages ?? []).flatMap((page) =>
      page.annotations.map((annotation) => annotation.id),
    ),
  );
  const pageByNumber = new Map((inspect?.pages ?? []).map((page) => [page.page, page]));

  for (const entry of mapping.mappings) {
    if (form && !formFields.has(entry.formField)) {
      issue.at(`pdfMappings.${mapping.id}.mappings`, `Unknown form field: ${entry.formField}`);
    }

    if (!entry.pdfField && !entry.annotation && !entry.annotationId) {
      issue.at(
        `pdfMappings.${mapping.id}.mappings`,
        `Mapping for ${entry.formField} must define pdfField, annotation, or annotationId`,
      );
    }

    if (entry.pdfField && inspect && !pdfFields.has(entry.pdfField)) {
      issue.at(`pdfMappings.${mapping.id}.mappings`, `Unknown PDF field: ${entry.pdfField}`);
    }

    if (entry.annotationId && annotationDoc && !annotationIds.has(entry.annotationId)) {
      issue.at(
        `pdfMappings.${mapping.id}.mappings`,
        `Unknown PDF annotation: ${entry.annotationId}`,
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

function collectFormFieldPaths(form: OnboardedFormConfig): readonly string[] {
  return form.version.pages.flatMap((page) => collectFieldPaths(page.fields));
}

function collectFieldPaths(
  fields: OnboardedFormConfig["version"]["pages"][number]["fields"],
): readonly string[] {
  return fields.flatMap((field) => [
    field.path,
    ...(field.subfields ? collectFieldPaths(field.subfields) : []),
  ]);
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
