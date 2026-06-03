import {
  decodePDFRawStream,
  PDFArray,
  PDFButton,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFRawStream,
  PDFSignature,
  PDFTextField,
  type PDFField,
  type PDFPage,
  type PDFRef,
} from "pdf-lib";

export type SchematicsPdfFieldType =
  | "button"
  | "checkbox"
  | "dropdown"
  | "option-list"
  | "radio"
  | "signature"
  | "text"
  | "unknown";

export interface SchematicsPdfPageGeometry {
  readonly page: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

export interface SchematicsPdfField {
  readonly name: string;
  readonly type: SchematicsPdfFieldType;
  readonly required: boolean;
  readonly readOnly: boolean;
}

/**
 * Structural inspection of a PDF, derived by actually parsing the document with
 * pdf-lib rather than scanning bytes. This is the kind of typed view a binary
 * artifact can expose that a schema-over-text file never could.
 */
export interface SchematicsPdfInspection {
  readonly kind: "pdf";
  readonly path: string;
  readonly byteLength: number;
  readonly headerVersion: string | null;
  readonly pageCount: number;
  readonly pages: readonly SchematicsPdfPageGeometry[];
  readonly fields: readonly SchematicsPdfField[];
  readonly hasXFA: boolean;
  readonly encrypted: boolean;
}

export interface SchematicsPdfPageText {
  readonly page: number;
  readonly text: string;
}

/**
 * Extracted text content of a PDF. `extractable` is `false` when no usable text
 * could be recovered (e.g. a scanned/image-only PDF, or fonts with custom
 * encodings we can't map) — callers should treat empty text as "not available",
 * never as "the document is blank".
 */
export interface SchematicsPdfTextExtraction {
  readonly kind: "pdf-text";
  readonly path: string;
  readonly pageCount: number;
  readonly pages: readonly SchematicsPdfPageText[];
  readonly text: string;
  readonly extractable: boolean;
}

type PdfEncoding = "base64" | "data-url" | "binary-string";

interface DecodedPdfContent {
  readonly bytes: Uint8Array;
  readonly encoding: PdfEncoding;
}

/** Decodes a stored PDF's string content into raw bytes, mirroring the agent's encodings. */
export function decodePdfBytes(content: string): Uint8Array {
  return decodePdfContent(content).bytes;
}

function decodePdfContent(content: string): DecodedPdfContent {
  if (content.startsWith("%PDF")) {
    return { bytes: binaryStringToBytes(content), encoding: "binary-string" };
  }
  const dataUrlMatch = content.match(/^data:application\/pdf[^,]*;base64,([\s\S]*)$/i);
  if (dataUrlMatch?.[1] !== undefined) {
    return { bytes: base64ToBytes(dataUrlMatch[1]), encoding: "data-url" };
  }
  return { bytes: base64ToBytes(content), encoding: "base64" };
}

export async function inspectPdf(content: string, path: string): Promise<SchematicsPdfInspection> {
  const bytes = decodePdfBytes(content);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();

  return {
    kind: "pdf",
    path,
    byteLength: bytes.byteLength,
    headerVersion: headerVersion(bytes),
    pageCount: pdfDoc.getPageCount(),
    pages: pages.map((page, index) => {
      const size = page.getSize();
      return {
        page: index + 1,
        width: round(size.width),
        height: round(size.height),
        rotation: page.getRotation().angle,
      };
    }),
    fields: pdfDoc
      .getForm()
      .getFields()
      .map((field) => ({
        name: field.getName(),
        type: fieldType(field),
        required: field.isRequired(),
        readOnly: field.isReadOnly(),
      })),
    hasXFA: hasXfa(pdfDoc),
    encrypted: pdfDoc.isEncrypted,
  };
}

export async function extractPdfText(
  content: string,
  path: string,
): Promise<SchematicsPdfTextExtraction> {
  const bytes = decodePdfBytes(content);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();

  const pageTexts = pages.map((page, index) => ({
    page: index + 1,
    text: extractPageText(page),
  }));
  const text = pageTexts
    .map((entry) => entry.text)
    .filter((value) => value.length > 0)
    .join("\n\n");

  return {
    kind: "pdf-text",
    path,
    pageCount: pdfDoc.getPageCount(),
    pages: pageTexts,
    text,
    // Heuristic: treat the result as usable only when it contains a reasonable
    // amount of printable text, so garbled CID-font output reads as "not
    // extractable" rather than as real content.
    extractable: isLikelyText(text),
  };
}

function extractPageText(page: PDFPage): string {
  const decoded = pageContentBytes(page);
  if (!decoded) return "";
  // Content stream operators are Latin-1 byte sequences; string operands map
  // byte→char for the standard encodings we can handle.
  const stream = latin1(decoded);
  return normalizeWhitespace(extractTextOperators(stream));
}

function pageContentBytes(page: PDFPage): Uint8Array | null {
  try {
    const context = page.doc.context;
    const contents = page.node.normalizedEntries().Contents;
    if (!(contents instanceof PDFArray)) return null;
    const chunks: Uint8Array[] = [];
    for (const entry of contents.asArray()) {
      const stream = context.lookup(entry as PDFRef);
      if (stream instanceof PDFRawStream) {
        chunks.push(decodePDFRawStream(stream).decode());
      }
    }
    return chunks.length > 0 ? concatBytes(chunks) : null;
  } catch {
    return null;
  }
}

/**
 * Pulls text from the text-showing operators (`Tj`, `TJ`, `'`, `"`) of a
 * decoded content stream. Deliberately small: it understands literal and hex
 * string operands and TJ arrays, and ignores positioning/kerning. Anything it
 * can't parse simply contributes no text.
 */
function extractTextOperators(stream: string): string {
  const out: string[] = [];
  let index = 0;
  const length = stream.length;
  let pendingString: string | null = null;
  let pendingArray: string | null = null;

  while (index < length) {
    const char = stream[index]!;
    if (char === "(") {
      const [value, next] = readLiteralString(stream, index + 1);
      pendingString = value;
      index = next;
      continue;
    }
    if (char === "<" && stream[index + 1] !== "<") {
      const [value, next] = readHexString(stream, index + 1);
      pendingString = value;
      index = next;
      continue;
    }
    if (char === "[") {
      const [value, next] = readTjArray(stream, index + 1);
      pendingArray = value;
      index = next;
      continue;
    }
    if (char === "T" && stream[index + 1] === "j") {
      if (pendingString !== null) out.push(pendingString);
      pendingString = null;
      index += 2;
      continue;
    }
    if (char === "T" && stream[index + 1] === "J") {
      if (pendingArray !== null) out.push(pendingArray);
      pendingArray = null;
      index += 2;
      continue;
    }
    if ((char === "'" || char === '"') && pendingString !== null) {
      out.push(`\n${pendingString}`);
      pendingString = null;
      index += 1;
      continue;
    }
    index += 1;
  }

  return out.join("");
}

function readLiteralString(stream: string, start: number): [string, number] {
  let result = "";
  let depth = 1;
  let index = start;
  while (index < stream.length) {
    const char = stream[index]!;
    if (char === "\\") {
      const escaped = stream[index + 1];
      switch (escaped) {
        case "n":
          result += "\n";
          break;
        case "r":
          result += "\r";
          break;
        case "t":
          result += "\t";
          break;
        case "b":
        case "f":
          break;
        default:
          if (escaped !== undefined && escaped >= "0" && escaped <= "7") {
            const octal = stream.slice(index + 1, index + 4).match(/^[0-7]{1,3}/)?.[0] ?? "";
            result += String.fromCharCode(parseInt(octal, 8) & 0xff);
            index += octal.length + 1;
            continue;
          }
          if (escaped !== undefined) result += escaped;
      }
      index += 2;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return [result, index + 1];
    }
    result += char;
    index += 1;
  }
  return [result, index];
}

function readHexString(stream: string, start: number): [string, number] {
  const end = stream.indexOf(">", start);
  const hex = (end === -1 ? stream.slice(start) : stream.slice(start, end)).replace(/\s+/g, "");
  let result = "";
  for (let index = 0; index < hex.length; index += 2) {
    const pair = hex.slice(index, index + 2).padEnd(2, "0");
    result += String.fromCharCode(parseInt(pair, 16) & 0xff);
  }
  return [result, end === -1 ? stream.length : end + 1];
}

function readTjArray(stream: string, start: number): [string, number] {
  let result = "";
  let index = start;
  while (index < stream.length) {
    const char = stream[index]!;
    if (char === "]") return [result, index + 1];
    if (char === "(") {
      const [value, next] = readLiteralString(stream, index + 1);
      result += value;
      index = next;
      continue;
    }
    if (char === "<") {
      const [value, next] = readHexString(stream, index + 1);
      result += value;
      index = next;
      continue;
    }
    index += 1;
  }
  return [result, index];
}

function fieldType(field: PDFField): SchematicsPdfFieldType {
  if (field instanceof PDFButton) return "button";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFOptionList) return "option-list";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFSignature) return "signature";
  if (field instanceof PDFTextField) return "text";
  return "unknown";
}

function hasXfa(pdfDoc: PDFDocument): boolean {
  try {
    const acroForm = (
      pdfDoc.catalog as unknown as {
        AcroForm?: () => { dict?: { get: (name: unknown) => unknown } };
      }
    ).AcroForm?.();
    if (!acroForm?.dict) return false;
    // PDFName.of("XFA") would be cleaner, but a string probe keeps this resilient.
    return JSON.stringify(Object.keys(acroForm.dict)).includes("XFA") || Boolean(acroForm.dict);
  } catch {
    return false;
  }
}

function headerVersion(bytes: Uint8Array): string | null {
  const header = latin1(bytes.subarray(0, 16));
  return header.match(/^%PDF-(\d+\.\d+)/)?.[1] ?? null;
}

function isLikelyText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  let printable = 0;
  for (const char of trimmed) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126) || code >= 160) {
      printable += 1;
    }
  }
  return printable / trimmed.length >= 0.8;
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function latin1(bytes: Uint8Array): string {
  let result = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return result;
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ""));
  return binaryStringToBytes(binary);
}

function binaryStringToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index) & 0xff;
  }
  return bytes;
}
