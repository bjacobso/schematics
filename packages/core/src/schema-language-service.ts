import { parseDocument, stringifyDocument } from "./document-codec";
import type { SchematicsDocumentFormat, SchematicsReflection, SourceFile } from "./types";

export interface SchematicsCompletionItem {
  readonly label: string;
  readonly type: "property" | "value" | "reference";
  readonly apply: string;
  readonly detail?: string | undefined;
  readonly info?: string | undefined;
}

export interface SchematicsCompletionResult {
  readonly from: number;
  readonly to: number;
  readonly options: readonly SchematicsCompletionItem[];
}

export interface SchematicsHover {
  readonly from: number;
  readonly to: number;
  readonly content: string;
}

export interface SchematicsWorkspaceTextEdit {
  readonly path: string;
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export interface SchematicsQuickFix {
  readonly title: string;
  readonly diagnostics?: readonly number[] | undefined;
  readonly edits: readonly SchematicsWorkspaceTextEdit[];
}

export interface SchematicsDefinition {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly id: string;
}

export interface SchematicsReference extends SchematicsDefinition {
  readonly kind: "definition" | "reference";
  readonly property?: string | undefined;
}

export interface SchematicsLanguageServiceInput {
  readonly reflection: SchematicsReflection;
  readonly path?: string | null | undefined;
  readonly content?: string | undefined;
  readonly offset?: number | undefined;
  readonly format?: SchematicsDocumentFormat | undefined;
}

interface JsonSchemaObject {
  readonly type?: string | readonly string[] | undefined;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly enum?: readonly unknown[] | undefined;
  readonly default?: unknown;
  readonly required?: readonly string[] | undefined;
  readonly properties?: Readonly<Record<string, JsonSchemaObject>> | undefined;
  readonly items?: JsonSchemaObject | undefined;
  readonly anyOf?: readonly JsonSchemaObject[] | undefined;
  readonly oneOf?: readonly JsonSchemaObject[] | undefined;
  readonly allOf?: readonly JsonSchemaObject[] | undefined;
}

export function getSchematicsCompletions(
  input: SchematicsLanguageServiceInput,
): SchematicsCompletionResult | null {
  const content = getContent(input);
  const offset = clampOffset(input.offset ?? content.length, content);
  const schema = activeJsonSchema(input);
  if (!schema) return null;

  const token = tokenAt(content, offset);
  const activeProperty = propertyNameNearOffset(content, offset, input.format);
  const propertySchema =
    activeProperty && isObjectSchema(schema) ? schema.properties?.[activeProperty] : null;

  if (propertySchema?.enum?.length) {
    return {
      from: token.from,
      to: token.to,
      options: propertySchema.enum.map((value) => ({
        label: String(value),
        type: "value",
        apply: stringifyInline(value),
        detail: "enum",
        info: schemaDescription(propertySchema),
      })),
    };
  }

  if (!isObjectSchema(schema) || !schema.properties) return null;

  const parsed = parseCurrentDocument(input);
  const currentValue = isRecord(parsed) ? parsed : {};
  const options = Object.entries(schema.properties)
    .filter(([key]) => !Object.prototype.hasOwnProperty.call(currentValue, key))
    .map(([key, property]) => ({
      label: key,
      type: "property" as const,
      apply: propertyCompletionApply(key, property, input.format ?? input.reflection.activeFormat),
      detail: schemaTypeLabel(property),
      info: schemaDescription(property),
    }));

  if (!options.length) return null;
  return { from: token.from, to: token.to, options };
}

export function getSchematicsHover(input: SchematicsLanguageServiceInput): SchematicsHover | null {
  const content = getContent(input);
  const offset = clampOffset(input.offset ?? 0, content);
  const schema = activeJsonSchema(input);
  if (!isObjectSchema(schema) || !schema.properties) return null;

  const token = tokenAt(content, offset);
  const property = propertyNameNearOffset(content, offset, input.format) ?? token.text;
  const propertySchema = schema.properties[property];
  if (!propertySchema) return null;

  const parts = [
    property,
    schemaTypeLabel(propertySchema),
    schemaDescription(propertySchema),
    propertySchema.enum?.length ? `enum: ${propertySchema.enum.map(String).join(", ")}` : null,
  ].filter(Boolean);

  if (!parts.length) return null;
  return { from: token.from, to: token.to, content: parts.join("\n") };
}

export function getSchematicsQuickFixes(
  input: SchematicsLanguageServiceInput,
): readonly SchematicsQuickFix[] {
  const content = getContent(input);
  const schema = activeJsonSchema(input);
  if (!isObjectSchema(schema)) return [];

  const value = parseCurrentDocument(input);
  if (!isRecord(value)) return [];

  const missing = (schema.required ?? []).filter(
    (key) => !Object.prototype.hasOwnProperty.call(value, key),
  );

  return missing.flatMap((key) => {
    const property = schema.properties?.[key];
    if (!property) return [];
    const edit = editToAddTopLevelProperty({
      path: input.path ?? input.reflection.activeFile ?? "document.json",
      content,
      format: input.format ?? input.reflection.activeFormat,
      key,
      value: defaultValueForSchema(property),
    });
    return edit ? [{ title: `Add required field "${key}"`, edits: [edit] }] : [];
  });
}

export function getSchematicsDefinitions(
  input: SchematicsLanguageServiceInput,
): readonly SchematicsDefinition[] {
  const content = getContent(input);
  const token = stringValueAt(content, clampOffset(input.offset ?? 0, content));
  if (!token) return [];
  return buildReferenceIndex(input.reflection).definitions.filter(
    (definition) => definition.id === token.value,
  );
}

export function getSchematicsReferences(
  input: SchematicsLanguageServiceInput,
): readonly SchematicsReference[] {
  const content = getContent(input);
  const token = stringValueAt(content, clampOffset(input.offset ?? 0, content));
  if (!token) return [];
  const index = buildReferenceIndex(input.reflection);
  return [...index.definitions, ...index.references].filter(
    (reference) => reference.id === token.value,
  );
}

export function buildReferenceIndex(reflection: SchematicsReflection): {
  readonly definitions: readonly SchematicsReference[];
  readonly references: readonly SchematicsReference[];
} {
  const definitions: SchematicsReference[] = [];
  const references: SchematicsReference[] = [];

  for (const file of reflection.files) {
    const format = routeFormat(reflection, file.path);
    const parsed = parseDocument(file.content, format, file.path);
    if (!parsed.success) continue;
    collectReferenceEntries(file, parsed.value, definitions, references);
  }

  return { definitions, references };
}

function collectReferenceEntries(
  file: SourceFile,
  value: unknown,
  definitions: SchematicsReference[],
  references: SchematicsReference[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectReferenceEntries(file, item, definitions, references);
    return;
  }
  if (!isRecord(value)) return;

  const id = typeof value["id"] === "string" ? value["id"] : null;
  if (id) {
    definitions.push({
      ...locationOfValue(file.content, id),
      path: file.path,
      id,
      kind: "definition",
    });
  }

  for (const [key, raw] of Object.entries(value)) {
    if (key === "id") continue;
    if (typeof raw === "string" && /(^|[A-Z_:-])id$/i.test(key)) {
      references.push({
        ...locationOfValue(file.content, raw),
        path: file.path,
        id: raw,
        kind: "reference",
        property: key,
      });
    } else if (Array.isArray(raw) && /ids$/i.test(key)) {
      for (const item of raw) {
        if (typeof item !== "string") continue;
        references.push({
          ...locationOfValue(file.content, item),
          path: file.path,
          id: item,
          kind: "reference",
          property: key,
        });
      }
    } else {
      collectReferenceEntries(file, raw, definitions, references);
    }
  }
}

function activeJsonSchema(input: SchematicsLanguageServiceInput): JsonSchemaObject | null {
  const path = input.path ?? input.reflection.activeFile;
  if (!path) return asSchema(input.reflection.activeJsonSchema);
  const route = input.reflection.routeMatches.find((match) => match.path === path);
  if (!route?.schemaId) return asSchema(input.reflection.activeJsonSchema);
  return asSchema(
    input.reflection.schemas.find((schema) => schema.id === route.schemaId)?.jsonSchema,
  );
}

function parseCurrentDocument(input: SchematicsLanguageServiceInput): unknown {
  const content = getContent(input);
  const format = input.format ?? input.reflection.activeFormat;
  const parsed = parseDocument(content, format, input.path ?? input.reflection.activeFile);
  return parsed.success ? parsed.value : null;
}

function getContent(input: SchematicsLanguageServiceInput): string {
  if (input.content !== undefined) return input.content;
  const path = input.path ?? input.reflection.activeFile;
  return input.reflection.files.find((file) => file.path === path)?.content ?? "";
}

function asSchema(value: unknown): JsonSchemaObject | null {
  return isRecord(value) && !("error" in value) ? (value as JsonSchemaObject) : null;
}

function isObjectSchema(value: unknown): value is JsonSchemaObject {
  return isRecord(value);
}

function schemaDescription(schema: JsonSchemaObject): string | undefined {
  return schema.description ?? schema.title;
}

function schemaTypeLabel(schema: JsonSchemaObject): string {
  if (schema.enum?.length) return "enum";
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  if (typeof schema.type === "string") return schema.type;
  if (schema.properties) return "object";
  if (schema.items) return "array";
  return "value";
}

function propertyCompletionApply(
  key: string,
  schema: JsonSchemaObject,
  format: SchematicsDocumentFormat,
): string {
  const value = defaultValueForSchema(schema);
  if (format === "yaml") return `${key}: ${stringifyYamlInline(value)}`;
  return `"${key}": ${stringifyInline(value)}`;
}

function defaultValueForSchema(schema: JsonSchemaObject): unknown {
  if ("default" in schema) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case "boolean":
      return false;
    case "integer":
    case "number":
      return 0;
    case "array":
      return [];
    case "object":
      return {};
    case "null":
      return null;
    case "string":
    default:
      return "";
  }
}

function editToAddTopLevelProperty({
  path,
  content,
  format,
  key,
  value,
}: {
  readonly path: string;
  readonly content: string;
  readonly format: SchematicsDocumentFormat;
  readonly key: string;
  readonly value: unknown;
}): SchematicsWorkspaceTextEdit | null {
  if (format === "yaml") {
    const prefix = content.endsWith("\n") || content.length === 0 ? "" : "\n";
    return {
      path,
      from: content.length,
      to: content.length,
      insert: `${prefix}${key}: ${stringifyYamlInline(value)}\n`,
    };
  }

  const trimmed = content.trim();
  if (trimmed === "{}" || trimmed === "") {
    return {
      path,
      from: 0,
      to: content.length,
      insert: `{\n  "${key}": ${stringifyInline(value)}\n}\n`,
    };
  }

  const close = content.lastIndexOf("}");
  if (close < 0) return null;
  const beforeClose = content.slice(0, close).trimEnd();
  const needsComma = !beforeClose.endsWith("{") && !beforeClose.endsWith(",");
  const insert = `${needsComma ? "," : ""}\n  "${key}": ${stringifyInline(value)}\n`;
  return { path, from: close, to: close, insert };
}

function stringifyInline(value: unknown): string {
  return JSON.stringify(value);
}

function stringifyYamlInline(value: unknown): string {
  if (typeof value === "string") return value ? JSON.stringify(value) : '""';
  if (typeof value === "boolean" || typeof value === "number" || value === null)
    return String(value);
  return stringifyDocument(value, "yaml").trimEnd();
}

function tokenAt(
  content: string,
  offset: number,
): { readonly from: number; readonly to: number; readonly text: string } {
  const left = content.slice(0, offset).search(/[A-Za-z0-9_$:-]*$/);
  const from = left < 0 ? offset : left;
  const right = /^[A-Za-z0-9_$:-]*/.exec(content.slice(offset))?.[0].length ?? 0;
  const to = offset + right;
  return { from, to, text: content.slice(from, to).replace(/^["']|["']$/g, "") };
}

function propertyNameNearOffset(
  content: string,
  offset: number,
  format: SchematicsDocumentFormat | undefined,
): string | null {
  const line = lineAtOffset(content, offset).text;
  if (format === "yaml") {
    const match = /^(\s*)([A-Za-z0-9_$:-]+)\s*:/.exec(line);
    return match?.[2] ?? null;
  }

  const before = content.slice(0, offset);
  const quoted = /"([^"]+)"\s*:?\s*$/.exec(before);
  if (quoted) return quoted[1] ?? null;
  const sameLine = /"([^"]+)"\s*:/.exec(line);
  return sameLine?.[1] ?? null;
}

function stringValueAt(
  content: string,
  offset: number,
): { readonly value: string; readonly from: number; readonly to: number } | null {
  const before = content.lastIndexOf('"', offset);
  const after = content.indexOf('"', offset);
  if (before >= 0 && after > before) {
    return { value: content.slice(before + 1, after), from: before + 1, to: after };
  }
  const token = tokenAt(content, offset);
  return token.text ? { value: token.text, from: token.from, to: token.to } : null;
}

function routeFormat(reflection: SchematicsReflection, path: string): SchematicsDocumentFormat {
  return (
    reflection.routeMatches.find((route) => route.path === path)?.format ?? reflection.activeFormat
  );
}

function locationOfValue(
  content: string,
  value: string,
): { readonly line: number; readonly column: number } {
  const index = Math.max(0, content.indexOf(value));
  const line = lineAtOffset(content, index);
  return { line: line.number, column: index - line.from + 1 };
}

function lineAtOffset(
  content: string,
  offset: number,
): { readonly number: number; readonly from: number; readonly text: string } {
  const from = content.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const toIndex = content.indexOf("\n", offset);
  const to = toIndex === -1 ? content.length : toIndex;
  return {
    number: content.slice(0, from).split("\n").length,
    from,
    text: content.slice(from, to),
  };
}

function clampOffset(offset: number, content: string): number {
  return Math.max(0, Math.min(offset, content.length));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
