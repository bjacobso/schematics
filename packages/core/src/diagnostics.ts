import { SchemaIssue } from "effect";
import { formatDocumentPath, locateNearestSourceRange } from "./source-map";
import type { DocumentSourceMap, SchematicsDiagnostic, SchematicsValidationSummary } from "./types";

export function summarizeDiagnostics(
  diagnostics: readonly SchematicsDiagnostic[],
): SchematicsValidationSummary {
  return {
    valid: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    errorCount: diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
    warningCount: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
    infoCount: diagnostics.filter((diagnostic) => diagnostic.severity === "info").length,
  };
}

export function parseErrorToDiagnostics({
  error,
  path,
  source = "schema",
  sourceMap,
}: {
  readonly error: SchemaIssue.Issue;
  readonly path: string | null;
  readonly source?: SchematicsDiagnostic["source"];
  readonly sourceMap?: DocumentSourceMap | null | undefined;
}): readonly SchematicsDiagnostic[] {
  const issues = SchemaIssue.makeFormatterStandardSchemaV1()(error).issues ?? [];

  if (issues.length === 0) {
    return [
      {
        path,
        severity: "error",
        source,
        message: SchemaIssue.makeFormatterDefault()(error),
      },
    ];
  }

  return issues.map((issue) => {
    const documentPath = issue.path?.map(pathSegmentKey) ?? [];
    const range = sourceMap ? locateNearestSourceRange(sourceMap, documentPath) : null;

    return {
      path,
      severity: "error",
      source,
      message: issue.message,
      ...(documentPath.length > 0 ? { documentPath: formatIssuePath(documentPath) } : {}),
      ...(range ? { line: range.start.line, column: range.start.column } : {}),
    };
  });
}

export function formatIssuePath(path: readonly PropertyKey[]): string {
  return formatDocumentPath(path);
}

function pathSegmentKey(segment: unknown): PropertyKey {
  if (
    typeof segment === "object" &&
    segment !== null &&
    "key" in segment &&
    isPropertyKey(segment.key)
  ) {
    return segment.key;
  }
  return isPropertyKey(segment) ? segment : String(segment);
}

function isPropertyKey(value: unknown): value is PropertyKey {
  return typeof value === "string" || typeof value === "number" || typeof value === "symbol";
}
