import type { SchemaAST } from "effect";

export type SchemaIdeDocumentFormat = "json" | "yaml";

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

export interface SourceTree {
  readonly files: readonly SourceFile[];
}

export type SchemaIdeDiagnosticSource =
  | "json-parse"
  | "yaml-parse"
  | "schema"
  | "workspace"
  | "cross-file";

export interface SchemaIdeDiagnostic {
  readonly path: string | null;
  readonly documentPath?: string | undefined;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly source: SchemaIdeDiagnosticSource;
}

export interface SchemaIdeValidationSummary {
  readonly valid: boolean;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
}

export interface ReflectedSchema {
  readonly id: string;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly match?: string | undefined;
  readonly jsonSchema: unknown;
}

export interface RouteMatch {
  readonly path: string;
  readonly schemaId: string | null;
  readonly format: SchemaIdeDocumentFormat;
}

export interface SchemaIdeReflection {
  readonly mode: "document" | "workspace";
  readonly activeFile: string | null;
  readonly activeFormat: SchemaIdeDocumentFormat;
  readonly files: readonly SourceFile[];
  readonly schemas: readonly ReflectedSchema[];
  readonly activeJsonSchema: unknown | null;
  readonly decodedValue: unknown | null;
  readonly diagnostics: readonly SchemaIdeDiagnostic[];
  readonly validationSummary: SchemaIdeValidationSummary;
  readonly routeMatches: readonly RouteMatch[];
}

export interface ValidationResult<A = unknown> {
  readonly value: A | null;
  readonly diagnostics: readonly SchemaIdeDiagnostic[];
  readonly summary: SchemaIdeValidationSummary;
  readonly routeMatches: readonly RouteMatch[];
}

export interface SchemaIdeParseSuccess<A> {
  readonly success: true;
  readonly value: A;
}

export interface SchemaIdeParseFailure {
  readonly success: false;
  readonly diagnostic: SchemaIdeDiagnostic;
}

export type SchemaIdeParseResult<A> = SchemaIdeParseSuccess<A> | SchemaIdeParseFailure;

export interface SchemaIdeDocumentCodec {
  readonly format: SchemaIdeDocumentFormat;
  readonly extensions: readonly string[];
  readonly parse: (text: string, path?: string | null) => SchemaIdeParseResult<unknown>;
  readonly stringify: (value: unknown) => string;
}

export interface AnySchema {
  readonly ast: SchemaAST.AST;
}
