import { Schema } from "effect";
import { Relation, validateRelations, type RelationDiagnostic } from "@schema-ide/schema-algebra";
import type { WorkspaceIssue } from "./common";
import {
  OnboardedDocumentConfigSchema,
  annotationsForDocument,
  buildPdfAnnotationRegistry,
  buildPdfInspectRegistry,
  inspectForDocument,
  type DocumentFileEntry,
  type OnboardedDocumentConfig,
  type OnboardedPdfAnnotationDocument,
  type OnboardedPdfInspect,
} from "./documents";
import { OnboardedFormConfigSchema, type OnboardedFormConfig } from "./forms";
import { OnboardedPdfMappingConfigSchema, type OnboardedPdfMappingConfig } from "./pdf-mappings";

const PdfFieldRelationSchema = Relation.derivedId(
  Schema.Struct({
    name: Schema.String,
  }),
  "PdfField",
  { id: "name", scope: Relation.parent("PdfInspection") },
);

const PdfInspectionRelationSchema = Schema.Struct({
  id: Relation.id("PdfInspection"),
  fields: Schema.Array(PdfFieldRelationSchema),
});

const PdfAnnotationRelationSchema = Relation.derivedId(
  Schema.Struct({
    id: Schema.String,
  }),
  "PdfAnnotation",
  { id: "id", scope: Relation.parent("PdfAnnotationDocument") },
);

const PdfAnnotationPageRelationSchema = Schema.Struct({
  annotations: Schema.Array(PdfAnnotationRelationSchema),
});

const PdfAnnotationDocumentRelationSchema = Schema.Struct({
  id: Relation.id("PdfAnnotationDocument"),
  pages: Schema.Array(PdfAnnotationPageRelationSchema),
});

export const OnboardedRelationProjectSchema = Schema.Struct({
  forms: Schema.Array(OnboardedFormConfigSchema),
  documents: Schema.Array(OnboardedDocumentConfigSchema),
  pdfInspections: Schema.Array(PdfInspectionRelationSchema),
  pdfAnnotations: Schema.Array(PdfAnnotationDocumentRelationSchema),
  pdfMappings: Schema.Array(OnboardedPdfMappingConfigSchema),
});

export type OnboardedRelationWorkspace = typeof OnboardedRelationProjectSchema.Type;

export function createOnboardedRelationWorkspace(workspace: {
  readonly forms: readonly OnboardedFormConfig[];
  readonly documents: readonly DocumentFileEntry<OnboardedDocumentConfig>[];
  readonly pdfInspections: readonly DocumentFileEntry<OnboardedPdfInspect>[];
  readonly pdfAnnotations: readonly DocumentFileEntry<OnboardedPdfAnnotationDocument>[];
  readonly pdfMappings: readonly OnboardedPdfMappingConfig[];
}): OnboardedRelationWorkspace {
  const documents = new Map(workspace.documents.map((document) => [document.value.id, document]));
  const inspections = buildPdfInspectRegistry(workspace.pdfInspections);
  const annotations = buildPdfAnnotationRegistry(workspace.pdfAnnotations);
  return buildRelationWorkspace(workspace, documents, inspections, annotations);
}

export function validateOnboardedRelations(
  workspace: {
    readonly forms: readonly OnboardedFormConfig[];
    readonly documents: readonly DocumentFileEntry<OnboardedDocumentConfig>[];
    readonly pdfMappings: readonly OnboardedPdfMappingConfig[];
  },
  documents: ReadonlyMap<string, DocumentFileEntry<OnboardedDocumentConfig>>,
  inspections: ReadonlyMap<string, OnboardedPdfInspect>,
  annotations: ReadonlyMap<string, OnboardedPdfAnnotationDocument>,
  issue: WorkspaceIssue,
) {
  const relationValue = buildRelationWorkspace(workspace, documents, inspections, annotations);
  for (const diagnostic of validateRelations(OnboardedRelationProjectSchema, relationValue)) {
    if (diagnostic.code !== "unresolved-ref") continue;
    issue.at(
      issuePathForRelationDiagnostic(diagnostic, relationValue),
      messageForRelationDiagnostic(diagnostic),
    );
  }
}

function buildRelationWorkspace(
  workspace: {
    readonly forms: readonly OnboardedFormConfig[];
    readonly documents: readonly DocumentFileEntry<OnboardedDocumentConfig>[];
    readonly pdfMappings: readonly OnboardedPdfMappingConfig[];
  },
  documents: ReadonlyMap<string, DocumentFileEntry<OnboardedDocumentConfig>>,
  inspections: ReadonlyMap<string, OnboardedPdfInspect>,
  annotations: ReadonlyMap<string, OnboardedPdfAnnotationDocument>,
): OnboardedRelationWorkspace {
  return {
    forms: workspace.forms,
    documents: workspace.documents.map((document) => document.value),
    pdfInspections: [...documents.values()].map((document) =>
      pdfInspectionRelationValue(document, inspections, workspace.pdfMappings),
    ),
    pdfAnnotations: [...documents.values()].map((document) =>
      pdfAnnotationRelationValue(document, annotations, workspace.pdfMappings),
    ),
    pdfMappings: workspace.pdfMappings,
  };
}

function pdfInspectionRelationValue(
  document: DocumentFileEntry<OnboardedDocumentConfig>,
  inspections: ReadonlyMap<string, OnboardedPdfInspect>,
  mappings: readonly OnboardedPdfMappingConfig[],
) {
  const inspect = inspectForDocument(document, inspections);
  return {
    id: document.value.id,
    fields:
      inspect?.fields?.map((field) => ({ name: field.name })) ??
      syntheticPdfFields(document.value.id, mappings),
  };
}

function pdfAnnotationRelationValue(
  document: DocumentFileEntry<OnboardedDocumentConfig>,
  annotations: ReadonlyMap<string, OnboardedPdfAnnotationDocument>,
  mappings: readonly OnboardedPdfMappingConfig[],
) {
  const annotationDoc = annotationsForDocument(document, annotations);
  return {
    id: document.value.id,
    pages: annotationDoc?.pages.map((page) => ({
      annotations: page.annotations.map((annotation) => ({ id: annotation.id })),
    })) ?? [{ annotations: syntheticPdfAnnotations(document.value.id, mappings) }],
  };
}

function syntheticPdfFields(
  documentId: string,
  mappings: readonly OnboardedPdfMappingConfig[],
): readonly { readonly name: string }[] {
  return unique(
    mappings
      .filter((mapping) => mapping.document === documentId)
      .flatMap((mapping) => mapping.mappings.flatMap((entry) => entry.pdfField ?? [])),
  ).map((name) => ({ name }));
}

function syntheticPdfAnnotations(
  documentId: string,
  mappings: readonly OnboardedPdfMappingConfig[],
): readonly { readonly id: string }[] {
  return unique(
    mappings
      .filter((mapping) => mapping.document === documentId)
      .flatMap((mapping) => mapping.mappings.flatMap((entry) => entry.annotationId ?? [])),
  ).map((id) => ({ id }));
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function messageForRelationDiagnostic(diagnostic: RelationDiagnostic): string {
  const relation = diagnostic.relation;
  if (!("target" in relation)) return diagnostic.message;

  switch (relation.target) {
    case "Form":
      return `Unknown form: ${relation.id}`;
    case "Document":
      return `Unknown document: ${relation.id}`;
    case "FormField":
      return `Unknown form field: ${relation.id}`;
    case "PdfField":
      return `Unknown PDF field: ${relation.id}`;
    case "PdfAnnotation":
      return `Unknown PDF annotation: ${relation.id}`;
    default:
      return diagnostic.message;
  }
}

function issuePathForRelationDiagnostic(
  diagnostic: RelationDiagnostic,
  workspace: OnboardedRelationWorkspace,
): string {
  const [collection, index, maybeProperty] = diagnostic.path;
  if (collection === "pdfMappings") {
    const mapping = workspace.pdfMappings[Number(index)];
    return maybeProperty === "mappings"
      ? `pdfMappings.${mapping?.id ?? index}.mappings`
      : `pdfMappings.${mapping?.id ?? index}.${maybeProperty ?? "id"}`;
  }

  return collection ?? "relations";
}
