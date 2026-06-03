import type { SchematicsDiagnostic } from "@schematics/core";

export interface SchematicsFileDiagnosticCount {
  readonly errors: number;
  readonly warnings: number;
  readonly infos: number;
}

export function diagnosticsForSchematicsFile(
  diagnostics: readonly SchematicsDiagnostic[],
  path: string | null,
): readonly SchematicsDiagnostic[] {
  if (!path) return [];
  return diagnostics.filter((diagnostic) => diagnostic.path === path);
}

export function getSchematicsFileDiagnosticCounts(
  diagnostics: readonly SchematicsDiagnostic[],
): ReadonlyMap<string, SchematicsFileDiagnosticCount> {
  const counts = new Map<string, SchematicsFileDiagnosticCount>();

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
