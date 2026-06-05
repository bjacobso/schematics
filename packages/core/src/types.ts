import type { SchemaAST } from "effect";
import type { ArtifactProjectFileClass } from "@schematics/artifacts";

export type SchematicsDocumentFormat = "json" | "yaml";

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

export interface SourceTree {
  readonly files: readonly SourceFile[];
}

export type SchematicsDiagnosticSource =
  | "json-parse"
  | "yaml-parse"
  | "schema"
  | "workspace"
  | "cross-file";

export interface SchematicsDiagnostic {
  readonly path: string | null;
  readonly documentPath?: string | undefined;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly source: SchematicsDiagnosticSource;
}

export interface SchematicsValidationSummary {
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
  readonly format: SchematicsDocumentFormat;
  readonly fileClass?: ArtifactProjectFileClass | undefined;
}

export interface SchematicsReflection {
  readonly mode: "document" | "workspace";
  readonly activeFile: string | null;
  readonly activeFormat: SchematicsDocumentFormat;
  readonly files: readonly SourceFile[];
  readonly schemas: readonly ReflectedSchema[];
  readonly activeJsonSchema: unknown | null;
  readonly decodedValue: unknown | null;
  readonly diagnostics: readonly SchematicsDiagnostic[];
  readonly validationSummary: SchematicsValidationSummary;
  readonly routeMatches: readonly RouteMatch[];
}

export interface ValidationResult<A = unknown> {
  readonly value: A | null;
  readonly diagnostics: readonly SchematicsDiagnostic[];
  readonly summary: SchematicsValidationSummary;
  readonly routeMatches: readonly RouteMatch[];
}

export interface SchematicsParseSuccess<A> {
  readonly success: true;
  readonly value: A;
}

export interface SchematicsParseFailure {
  readonly success: false;
  readonly diagnostic: SchematicsDiagnostic;
}

export type SchematicsParseResult<A> = SchematicsParseSuccess<A> | SchematicsParseFailure;

export interface SchematicsDocumentCodec {
  readonly format: SchematicsDocumentFormat;
  readonly extensions: readonly string[];
  readonly parse: (text: string, path?: string | null) => SchematicsParseResult<unknown>;
  readonly stringify: (value: unknown) => string;
}

export interface AnySchema {
  readonly ast: SchemaAST.AST;
}
