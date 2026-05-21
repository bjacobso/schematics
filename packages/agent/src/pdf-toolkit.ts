import {
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  type PDFField,
} from "pdf-lib";
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import { stringifyDocument, type SchemaIdeDocumentFormat } from "@schema-ide/core";
import { ToolFailure } from "./common-toolkit-schemas";
import {
  PdfFieldType,
  PdfInspectSuccess,
  PdfRenderPageScreenshotSuccess,
  PdfUpdateFormAnnotationsParameters,
  PdfUpdateFormAnnotationsSuccess,
} from "./pdf-schemas";
import { SchemaIdeWorkspace, toToolFailure, toolFailure } from "./schema-ide-workspace";

export const PdfInspectTool = Tool.make("pdf_inspect", {
  description:
    "Read a PDF file and return page, form field, and coordinate metadata. Optionally writes that metadata to a workspace file.",
  parameters: Schema.Struct({
    path: Schema.String,
    outputPath: Schema.optional(Schema.String),
    outputFormat: Schema.optional(Schema.Literals(["json", "yaml"])),
    validate: Schema.optional(Schema.Boolean),
  }),
  success: PdfInspectSuccess,
  failure: ToolFailure,
  failureMode: "return",
});

export const PdfUpdateFormAnnotationsTool = Tool.make("pdf_update_form_annotations", {
  description: "Create or replace generated PDF form widgets from an annotation document.",
  parameters: PdfUpdateFormAnnotationsParameters,
  success: PdfUpdateFormAnnotationsSuccess,
  failure: ToolFailure,
  failureMode: "return",
});

export const PdfRenderPageScreenshotTool = Tool.make("pdf_render_page_screenshot", {
  description: "Render a PDF page to an image when the host runtime has a renderer configured.",
  parameters: Schema.Struct({
    path: Schema.String,
    page: Schema.Number,
    scale: Schema.optional(Schema.Number),
    outputPath: Schema.optional(Schema.String),
  }),
  success: PdfRenderPageScreenshotSuccess,
  failure: ToolFailure,
  failureMode: "return",
});

export const PdfToolkit = Toolkit.make(
  PdfInspectTool,
  PdfUpdateFormAnnotationsTool,
  PdfRenderPageScreenshotTool,
);

export const PdfToolkitLayer = PdfToolkit.toLayer(
  Effect.gen(function* () {
    const workspace = yield* SchemaIdeWorkspace;
    return PdfToolkit.of({
      pdf_inspect: Effect.fn("PdfToolkit.pdf_inspect")(function* ({
        path,
        outputPath,
        outputFormat,
        validate,
      }) {
        const file = yield* workspace.readFile(path);
        const inspect = yield* inspectPdfFileEffect(file.content);
        if (!outputPath) return inspect;

        yield* workspace.applyEdits(
          [
            {
              path: outputPath,
              content: `${stringifyDocument(
                inspect,
                outputFormat ?? documentFormatForPath(outputPath),
              )}\n`,
            },
          ],
          { validate },
        );

        return { ...inspect, writtenPath: outputPath };
      }),
      pdf_update_form_annotations: Effect.fn("PdfToolkit.pdf_update_form_annotations")(function* ({
        path,
        annotationDoc,
        coordinateSystem = "screenshot-pixels",
        fieldNamePrefix,
        removeExisting,
        validate,
      }) {
        const file = yield* workspace.readFile(path);

        const updated = yield* updatePdfFormAnnotationsEffect({
          content: file.content,
          annotationDoc,
          coordinateSystem,
          fieldNamePrefix,
          removeExisting,
        });
        const result = yield* workspace.applyEdits([{ path, content: updated.content }], {
          validate,
        });
        return {
          success: true,
          path,
          operation: "pdf_update_form_annotations" as const,
          coordinateSystem,
          fieldsCreated: updated.fieldsCreated,
          fieldsRemoved: updated.fieldsRemoved,
          pages: updated.pages,
          annotationCount: updated.annotationCount,
          validation: result.validation,
        };
      }),
      pdf_render_page_screenshot: Effect.fn("PdfToolkit.pdf_render_page_screenshot")(function* ({
        path,
      }) {
        return yield* Effect.fail(
          toolFailure(
            `PDF page rendering is not configured for ${path}. ` +
              "Wire a host renderer such as pdf-to-img, Poppler, Puppeteer, or another rasterizer.",
          ),
        );
      }),
    });
  }),
);

type PdfEncoding = "base64" | "data-url" | "binary-string";

interface DecodedPdfContent {
  readonly bytes: Uint8Array;
  readonly encoding: PdfEncoding;
  readonly dataUrlPrefix?: string | undefined;
}

function inspectPdfFileEffect(content: string) {
  return Effect.tryPromise({
    try: () => inspectPdfFile(content),
    catch: toToolFailure,
  });
}

function updatePdfFormAnnotationsEffect(options: Parameters<typeof updatePdfFormAnnotations>[0]) {
  return Effect.tryPromise({
    try: () => updatePdfFormAnnotations(options),
    catch: toToolFailure,
  });
}

function documentFormatForPath(path: string): SchemaIdeDocumentFormat {
  return /\.ya?ml$/i.test(path) ? "yaml" : "json";
}

function decodePdfContent(content: string): DecodedPdfContent {
  if (content.startsWith("%PDF")) {
    return { bytes: binaryStringToBytes(content), encoding: "binary-string" };
  }

  const dataUrlMatch = content.match(/^(data:application\/pdf[^,]*;base64,)([\s\S]*)$/i);
  if (dataUrlMatch?.[1] && dataUrlMatch[2] !== undefined) {
    return {
      bytes: base64ToBytes(dataUrlMatch[2]),
      encoding: "data-url",
      dataUrlPrefix: dataUrlMatch[1],
    };
  }

  return { bytes: base64ToBytes(content), encoding: "base64" };
}

function encodePdfContent(decoded: DecodedPdfContent, bytes: Uint8Array): string {
  if (decoded.encoding === "binary-string") return bytesToBinaryString(bytes);
  const base64 = bytesToBase64(bytes);
  return decoded.encoding === "data-url"
    ? `${decoded.dataUrlPrefix ?? "data:application/pdf;base64,"}${base64}`
    : base64;
}

async function inspectPdfFile(content: string) {
  const decoded = decodePdfContent(content);
  const pdfDoc = await PDFDocument.load(decoded.bytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  const pageMetadata = pages.map((page, index) => {
    const size = page.getSize();
    return {
      page: index + 1,
      width: size.width,
      height: size.height,
      rotation: page.getRotation().angle,
    };
  });
  const pageIndexByRef = new Map(pages.map((page, index) => [String(page.ref), index + 1]));

  return {
    kind: "pdf" as const,
    encoding: decoded.encoding,
    byteLength: decoded.bytes.byteLength,
    headerVersion: getPdfHeaderVersion(decoded.bytes),
    pageCount: pdfDoc.getPageCount(),
    pages: pageMetadata,
    fields: pdfDoc
      .getForm()
      .getFields()
      .map((field) => inspectPdfField(field, pages, pageIndexByRef)),
    hasXFA: pdfHasXfa(pdfDoc),
  };
}

function inspectPdfField(
  field: PDFField,
  pages: ReturnType<PDFDocument["getPages"]>,
  pageIndexByRef: ReadonlyMap<string, number>,
) {
  const widgets = getPdfFieldWidgets(field).map((widget) => {
    const rect = widget.getRectangle();
    const pageNumber = widget.P() ? (pageIndexByRef.get(String(widget.P())) ?? null) : null;
    const page = pageNumber ? pages[pageNumber - 1] : undefined;
    const pageHeight = page?.getSize().height;
    return {
      page: pageNumber,
      rect,
      screenshotRect:
        pageHeight === undefined
          ? null
          : {
              x: rect.x,
              y: pageHeight - rect.y - rect.height,
              width: rect.width,
              height: rect.height,
            },
    };
  });

  return {
    name: field.getName(),
    type: pdfFieldType(field),
    required: field.isRequired(),
    readOnly: field.isReadOnly(),
    widgets,
  };
}

async function updatePdfFormAnnotations({
  content,
  annotationDoc,
  coordinateSystem,
  fieldNamePrefix,
  removeExisting,
}: {
  readonly content: string;
  readonly annotationDoc: typeof PdfUpdateFormAnnotationsParameters.Type.annotationDoc;
  readonly coordinateSystem: "screenshot-pixels" | "pdf-points";
  readonly fieldNamePrefix?: string | undefined;
  readonly removeExisting?: boolean | undefined;
}) {
  const decoded = decodePdfContent(content);
  const pdfDoc = await PDFDocument.load(decoded.bytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const prefix = fieldNamePrefix ?? "annotation";
  const fieldsRemoved =
    removeExisting === false
      ? []
      : form
          .getFields()
          .filter((field) => field.getName().startsWith(`${prefix}.`))
          .map((field) => {
            const name = field.getName();
            form.removeField(field);
            return name;
          });

  const fieldsCreated: string[] = [];
  const pagesTouched = new Set<number>();
  let annotationCount = 0;
  const radioGroups = new Map<string, PDFRadioGroup>();

  for (const pageAnnotations of annotationDoc.pages) {
    const page = pdfDoc.getPage(pageAnnotations.page - 1);
    const pageHeight = page.getSize().height;
    pagesTouched.add(pageAnnotations.page);

    for (const annotation of pageAnnotations.annotations) {
      annotationCount += 1;
      const rect =
        coordinateSystem === "screenshot-pixels"
          ? {
              x: annotation.bbox.x,
              y: pageHeight - annotation.bbox.y - annotation.bbox.height,
              width: annotation.bbox.width,
              height: annotation.bbox.height,
            }
          : annotation.bbox;
      const widgetOptions = { ...rect, borderWidth: 0 };
      const fieldName =
        annotation.type === "radio"
          ? `${prefix}.${annotation.group ?? `page_${pageAnnotations.page}`}`
          : `${prefix}.page_${pageAnnotations.page}.${annotation.id}`;

      if (annotation.type === "radio") {
        const radioGroup = radioGroups.get(fieldName) ?? form.createRadioGroup(fieldName);
        radioGroups.set(fieldName, radioGroup);
        radioGroup.addOptionToPage(annotation.id, page, widgetOptions);
        if (annotation.required) radioGroup.enableRequired();
        if (annotation.value === true || annotation.value === annotation.id) {
          radioGroup.select(annotation.id);
        }
        if (!fieldsCreated.includes(fieldName)) fieldsCreated.push(fieldName);
        continue;
      }

      const field =
        annotation.type === "checkbox"
          ? form.createCheckBox(fieldName)
          : form.createTextField(fieldName);
      if (annotation.required) field.enableRequired();

      if (field instanceof PDFCheckBox) {
        if (annotation.value === true) field.check();
        field.addToPage(page, widgetOptions);
      } else {
        if (annotation.type === "multiline" || annotation.type === "signature") {
          field.enableMultiline();
        }
        if (typeof annotation.value === "string") field.setText(annotation.value);
        field.addToPage(page, widgetOptions);
      }
      fieldsCreated.push(fieldName);
    }
  }

  const updatedBytes = await pdfDoc.save();
  return {
    content: encodePdfContent(decoded, updatedBytes),
    fieldsCreated,
    fieldsRemoved,
    pages: [...pagesTouched].sort((left, right) => left - right),
    annotationCount,
  };
}

function getPdfFieldWidgets(field: PDFField): readonly {
  getRectangle: () => { x: number; y: number; width: number; height: number };
  P: () => unknown;
}[] {
  return (field.acroField as unknown as { getWidgets?: () => readonly any[] }).getWidgets?.() ?? [];
}

function pdfFieldType(field: PDFField): typeof PdfFieldType.Type {
  if (field instanceof PDFButton) return "button";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFOptionList) return "option-list";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFSignature) return "signature";
  if (field instanceof PDFTextField) return "text";
  return "unknown";
}

function pdfHasXfa(pdfDoc: PDFDocument): boolean {
  try {
    const acroForm = (
      pdfDoc.catalog as unknown as { AcroForm?: () => { dict?: PDFDict } | undefined }
    ).AcroForm?.();
    return Boolean(acroForm?.dict?.get(PDFName.of("XFA")));
  } catch {
    return false;
  }
}

function getPdfHeaderVersion(bytes: Uint8Array): string | null {
  const header = bytesToBinaryString(bytes.slice(0, 16));
  return header.match(/^%PDF-(\d+\.\d+)/)?.[1] ?? null;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ""));
  return binaryStringToBytes(binary);
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(bytesToBinaryString(bytes));
}

function binaryStringToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return binary;
}
