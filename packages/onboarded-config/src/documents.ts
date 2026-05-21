import { Schema } from "effect";
import type { SourceFile } from "@schema-ide/core";
import { Relation } from "@schema-ide/schema-algebra";
import type { WorkspaceIssue } from "./common";

export const OnboardedGeneratedScreenshotSchema = Schema.Struct({
  page: Schema.Number,
  file: Schema.String,
  scale: Schema.optional(Schema.Number),
});
export type OnboardedGeneratedScreenshot = typeof OnboardedGeneratedScreenshotSchema.Type;

export const OnboardedDocumentConfigSchema = Schema.Struct({
  id: Relation.id("Document", { display: "name" }),
  name: Schema.String,
  kind: Schema.Literal("pdf"),
  file: Schema.String,
  source: Schema.optional(
    Schema.Struct({
      system: Schema.String,
      version: Schema.optional(Schema.String),
      originalName: Schema.optional(Schema.String),
    }),
  ),
  generated: Schema.optional(
    Schema.Struct({
      inspect: Schema.optional(Schema.String),
      annotations: Schema.optional(Schema.String),
      screenshots: Schema.optional(Schema.Array(OnboardedGeneratedScreenshotSchema)),
    }),
  ),
});
export type OnboardedDocumentConfig = typeof OnboardedDocumentConfigSchema.Type;

export const PdfRectSchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
export type PdfRect = typeof PdfRectSchema.Type;

export const PdfFieldTypeSchema = Schema.Literals([
  "button",
  "checkbox",
  "dropdown",
  "option-list",
  "radio",
  "signature",
  "text",
  "unknown",
]);

export const OnboardedPdfInspectFieldSchema = Relation.derivedId(
  Schema.Struct({
    name: Schema.String,
    type: PdfFieldTypeSchema,
    required: Schema.optional(Schema.Boolean),
    readOnly: Schema.optional(Schema.Boolean),
    widgets: Schema.optional(
      Schema.Array(
        Schema.Struct({
          page: Schema.Union([Schema.Number, Schema.Null]),
          rect: PdfRectSchema,
          screenshotRect: Schema.optional(Schema.Union([PdfRectSchema, Schema.Null])),
        }),
      ),
    ),
  }),
  "PdfField",
  { id: "name", scope: Relation.parent("PdfInspection") },
);
export type OnboardedPdfInspectField = typeof OnboardedPdfInspectFieldSchema.Type;

export const OnboardedPdfInspectSchema = Schema.Struct({
  kind: Schema.Literal("pdf"),
  encoding: Schema.optional(Schema.Literals(["base64", "data-url", "binary-string"])),
  byteLength: Schema.optional(Schema.Number),
  headerVersion: Schema.optional(Schema.Union([Schema.String, Schema.Null])),
  pageCount: Schema.Number,
  pages: Schema.Array(
    Schema.Struct({
      page: Schema.Number,
      width: Schema.Number,
      height: Schema.Number,
      rotation: Schema.optional(Schema.Number),
    }),
  ),
  fields: Schema.optional(Schema.Array(OnboardedPdfInspectFieldSchema)),
  hasXFA: Schema.optional(Schema.Boolean),
});
export type OnboardedPdfInspect = typeof OnboardedPdfInspectSchema.Type;

export const OnboardedPdfAnnotationSchema = Relation.derivedId(
  Schema.Struct({
    id: Schema.String,
    type: Schema.Literals(["text", "multiline", "date", "checkbox", "radio", "signature"]),
    label: Schema.String,
    bbox: PdfRectSchema,
    group: Schema.optional(Schema.String),
    value: Schema.optional(Schema.Union([Schema.String, Schema.Boolean])),
    required: Schema.optional(Schema.Boolean),
    confidence: Schema.optional(Schema.Number),
    notes: Schema.optional(Schema.String),
  }),
  "PdfAnnotation",
  { id: "id", scope: Relation.parent("PdfAnnotationDocument") },
);
export type OnboardedPdfAnnotation = typeof OnboardedPdfAnnotationSchema.Type;

export const OnboardedPdfAnnotationDocumentSchema = Schema.Struct({
  formName: Schema.optional(Schema.String),
  pages: Schema.Array(
    Schema.Struct({
      page: Schema.Number,
      width: Schema.optional(Schema.Number),
      height: Schema.optional(Schema.Number),
      annotations: Schema.Array(OnboardedPdfAnnotationSchema),
    }),
  ),
});
export type OnboardedPdfAnnotationDocument = typeof OnboardedPdfAnnotationDocumentSchema.Type;

export type DocumentFileEntry<A> = {
  readonly path: string;
  readonly value: A;
};

export function buildDocumentRegistry(
  documents: readonly DocumentFileEntry<OnboardedDocumentConfig>[],
  issue: WorkspaceIssue,
): Map<string, DocumentFileEntry<OnboardedDocumentConfig>> {
  const registry = new Map<string, DocumentFileEntry<OnboardedDocumentConfig>>();

  for (const document of documents) {
    if (registry.has(document.value.id)) {
      issue.at(
        `documents.${document.value.id}`,
        `Duplicate document id: ${document.value.id}`,
        document.path,
      );
    }
    registry.set(document.value.id, document);
  }

  return registry;
}

export function buildPdfInspectRegistry(
  inspections: readonly DocumentFileEntry<OnboardedPdfInspect>[],
): Map<string, OnboardedPdfInspect> {
  return new Map(inspections.map((inspection) => [inspection.path, inspection.value]));
}

export function buildPdfAnnotationRegistry(
  annotations: readonly DocumentFileEntry<OnboardedPdfAnnotationDocument>[],
): Map<string, OnboardedPdfAnnotationDocument> {
  return new Map(annotations.map((annotation) => [annotation.path, annotation.value]));
}

export function validateDocumentConfig(
  document: DocumentFileEntry<OnboardedDocumentConfig>,
  files: readonly SourceFile[],
  inspections: ReadonlyMap<string, OnboardedPdfInspect>,
  annotations: ReadonlyMap<string, OnboardedPdfAnnotationDocument>,
  issue: WorkspaceIssue,
) {
  const pdfPath = resolveDocumentRelativePath(document.path, document.value.file);
  if (!document.value.file.toLowerCase().endsWith(".pdf")) {
    issue.at(
      `documents.${document.value.id}.file`,
      "Document file must point to a PDF",
      document.path,
    );
  }
  if (!files.some((file) => file.path === pdfPath)) {
    issue.at(
      `documents.${document.value.id}.file`,
      `Document PDF not found: ${pdfPath}`,
      document.path,
    );
  }

  const generated = document.value.generated;
  if (!generated) return;

  const inspectPath = generated.inspect
    ? resolveDocumentRelativePath(document.path, generated.inspect)
    : null;
  if (inspectPath && !inspections.has(inspectPath)) {
    issue.at(
      `documents.${document.value.id}.generated.inspect`,
      `Generated inspect file not found: ${inspectPath}`,
      document.path,
    );
  }

  const annotationsPath = generated.annotations
    ? resolveDocumentRelativePath(document.path, generated.annotations)
    : null;
  if (annotationsPath && !annotations.has(annotationsPath)) {
    issue.at(
      `documents.${document.value.id}.generated.annotations`,
      `Generated annotations file not found: ${annotationsPath}`,
      document.path,
    );
  }

  for (const screenshot of generated.screenshots ?? []) {
    const screenshotPath = resolveDocumentRelativePath(document.path, screenshot.file);
    if (!files.some((file) => file.path === screenshotPath)) {
      issue.at(
        `documents.${document.value.id}.generated.screenshots`,
        `Generated screenshot file not found: ${screenshotPath}`,
        document.path,
      );
    }
  }
}

export function inspectForDocument(
  document: DocumentFileEntry<OnboardedDocumentConfig>,
  inspections: ReadonlyMap<string, OnboardedPdfInspect>,
): OnboardedPdfInspect | null {
  const inspectPath = document.value.generated?.inspect
    ? resolveDocumentRelativePath(document.path, document.value.generated.inspect)
    : null;
  return inspectPath ? (inspections.get(inspectPath) ?? null) : null;
}

export function annotationsForDocument(
  document: DocumentFileEntry<OnboardedDocumentConfig>,
  annotations: ReadonlyMap<string, OnboardedPdfAnnotationDocument>,
): OnboardedPdfAnnotationDocument | null {
  const annotationsPath = document.value.generated?.annotations
    ? resolveDocumentRelativePath(document.path, document.value.generated.annotations)
    : null;
  return annotationsPath ? (annotations.get(annotationsPath) ?? null) : null;
}

export function resolveDocumentRelativePath(documentPath: string, path: string): string {
  if (path.startsWith("/")) return normalizeWorkspacePath(path.slice(1));
  if (path.includes("/documents/") || path.startsWith("documents/")) {
    return normalizeWorkspacePath(path);
  }

  const base = documentPath.split("/").slice(0, -1).join("/");
  return normalizeWorkspacePath(`${base}/${path}`);
}

function normalizeWorkspacePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}
