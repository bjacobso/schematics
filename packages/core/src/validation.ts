import { Result, Schema, SchemaIssue } from "effect";
import { parseDocument } from "./document-codec";
import { parseErrorToDiagnostics, summarizeDiagnostics } from "./diagnostics";
import { isProjectSchema, type ProjectRouteMap, type ProjectSchema } from "./project-schema";
import { reflectEffectSchema, safeJsonSchema } from "./reflection";
import type {
  AnySchema,
  SchematicsDocumentFormat,
  SchematicsReflection,
  SourceFile,
  SourceTree,
  ValidationResult,
} from "./types";

export type SchematicsInputSchema<A = unknown, Routes extends ProjectRouteMap = ProjectRouteMap> =
  | Schema.Schema<A>
  | ProjectSchema<A, Routes>;

export function validateSingleDocument<A>({
  schema,
  content,
  format,
  path = null,
}: {
  readonly schema: Schema.Schema<A>;
  readonly content: string;
  readonly format: SchematicsDocumentFormat;
  readonly path?: string | null;
}): ValidationResult<A> {
  const parsed = parseDocument(content, format, path);

  if (!parsed.success) {
    const diagnostics = [parsed.diagnostic];
    return {
      value: null,
      diagnostics,
      summary: summarizeDiagnostics(diagnostics),
      routeMatches: [],
    };
  }

  const decoded = Schema.decodeUnknownResult(schema as never)(
    parsed.value,
  ) as unknown as Result.Result<A, SchemaIssue.Issue>;
  if (Result.isFailure(decoded)) {
    const diagnostics = parseErrorToDiagnostics({
      error: decoded.failure,
      path,
      source: "schema",
    });
    return {
      value: null,
      diagnostics,
      summary: summarizeDiagnostics(diagnostics),
      routeMatches: [],
    };
  }

  return {
    value: decoded.success,
    diagnostics: [],
    summary: summarizeDiagnostics([]),
    routeMatches: [],
  };
}

export function validateSchematicsValue<A>({
  schema,
  files,
  activeFile,
  activeFormat,
}: {
  readonly schema: SchematicsInputSchema<A>;
  readonly files: readonly SourceFile[];
  readonly activeFile: string | null;
  readonly activeFormat: SchematicsDocumentFormat;
}): ValidationResult<A> {
  if (isProjectSchema(schema)) {
    return schema.decode({ files }, { defaultFormat: activeFormat });
  }

  const file = activeFile ? files.find((candidate) => candidate.path === activeFile) : files[0];
  return validateSingleDocument({
    schema,
    content: file?.content ?? "",
    format: activeFormat,
    path: file?.path ?? null,
  });
}

export function createReflection<A>({
  schema,
  files,
  activeFile,
  activeFormat,
  validation,
}: {
  readonly schema: SchematicsInputSchema<A>;
  readonly files: readonly SourceFile[];
  readonly activeFile: string | null;
  readonly activeFormat: SchematicsDocumentFormat;
  readonly validation: ValidationResult<A>;
}): SchematicsReflection {
  const schemas = isProjectSchema(schema)
    ? schema.reflect()
    : [reflectEffectSchema({ id: "document", schema: schema as AnySchema })];

  const activeRoute = activeFile
    ? validation.routeMatches.find((route) => route.path === activeFile)
    : null;
  const activeSchema = activeRoute?.schemaId
    ? schemas.find((candidate) => candidate.id === activeRoute.schemaId)
    : schemas[0];

  return {
    mode: isProjectSchema(schema) ? "workspace" : "document",
    activeFile,
    activeFormat,
    files,
    schemas,
    activeJsonSchema:
      activeSchema?.jsonSchema ??
      (isProjectSchema(schema) ? null : safeJsonSchema(schema as AnySchema)),
    decodedValue: validation.value,
    diagnostics: validation.diagnostics,
    validationSummary: validation.summary,
    routeMatches: validation.routeMatches,
  };
}

export function sourceTreeFromFiles(files: readonly SourceFile[]): SourceTree {
  return { files };
}
