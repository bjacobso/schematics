import type { SchemaIdeDiagnostic } from "@schema-ide/core";

export interface SchemaIdeFileDiagnosticCount {
  readonly errors: number;
  readonly warnings: number;
  readonly infos: number;
}

export function diagnosticsForSchemaIdeFile(
  diagnostics: readonly SchemaIdeDiagnostic[],
  path: string | null,
): readonly SchemaIdeDiagnostic[] {
  if (!path) return [];
  return diagnostics.filter((diagnostic) => diagnostic.path === path);
}

export function getSchemaIdeFileDiagnosticCounts(
  diagnostics: readonly SchemaIdeDiagnostic[],
): ReadonlyMap<string, SchemaIdeFileDiagnosticCount> {
  const counts = new Map<string, SchemaIdeFileDiagnosticCount>();

  for (const diagnostic of diagnostics) {
    if (!diagnostic.path) continue;

    const current = counts.get(diagnostic.path) ?? {
      errors: 0,
      warnings: 0,
      infos: 0,
    };
    counts.set(diagnostic.path, {
      errors: current.errors + (diagnostic.severity === "error" ? 1 : 0),
      warnings: current.warnings + (diagnostic.severity === "warning" ? 1 : 0),
      infos: current.infos + (diagnostic.severity === "info" ? 1 : 0),
    });
  }

  return counts;
}
