import { Result, Schema, SchemaIssue } from "effect";
import type { ArtifactFileRoute, ArtifactProjectDeclaration } from "@schema-ide/artifacts";
import { formatForPath, parseDocument } from "./document-codec";
import { parseErrorToDiagnostics, summarizeDiagnostics } from "./diagnostics";
import type {
  SchemaIdeDiagnostic,
  SchemaIdeDocumentFormat,
  SourceFile,
  ValidationResult,
} from "./types";

export function validateArtifactProjectValue({
  project,
  files,
  activeFormat,
}: {
  readonly project: ArtifactProjectDeclaration<string, any, any>;
  readonly files: readonly SourceFile[];
  readonly activeFormat: SchemaIdeDocumentFormat;
}): ValidationResult<Record<string, unknown>> {
  const usedPaths = new Set<string>();
  const diagnostics: SchemaIdeDiagnostic[] = [];
  const value: Record<string, unknown> = {};

  for (const route of project.routes) {
    const matches = files.filter((file) => projectFileRoutes(project, file.path).includes(route));
    if (matches.length > 0) {
      for (const file of matches) usedPaths.add(file.path);
    }
    if (!route.schema) continue;

    if (matches.length === 0 && !routeOptional(route)) {
      diagnostics.push({
        path: null,
        severity: "error",
        source: "workspace",
        message: `No files matched ${route.pattern}`,
      });
    }

    const decodedFiles: { readonly path: string; readonly value: unknown }[] = [];
    for (const file of matches) {
      const format = formatForPath(file.path, activeFormat);
      const parsed = parseDocument(file.content, format, file.path);
      if (!parsed.success) {
        diagnostics.push(parsed.diagnostic);
        continue;
      }

      const decoded = Schema.decodeUnknownResult(route.schema as never)(
        parsed.value,
      ) as unknown as Result.Result<unknown, SchemaIssue.Issue>;
      if (Result.isFailure(decoded)) {
        diagnostics.push(
          ...parseErrorToDiagnostics({
            error: decoded.failure,
            path: file.path,
            source: "schema",
          }),
        );
        continue;
      }

      decodedFiles.push({ path: file.path, value: decoded.success });
    }

    value[routeWorkspaceField(route)] = projectRouteValue(route, decodedFiles);
  }

  for (const file of files) {
    if (!usedPaths.has(file.path) && !isWorkspaceSidecarPath(file.path)) {
      diagnostics.push({
        path: file.path,
        severity: "warning",
        source: "workspace",
        message: "File did not match any workspace schema route",
      });
    }
  }

  return {
    value: diagnostics.some((diagnostic) => diagnostic.severity === "error") ? null : value,
    diagnostics,
    summary: summarizeDiagnostics(diagnostics),
    routeMatches: artifactProjectRouteMatches(project, files, activeFormat),
  };
}

export function artifactProjectRouteMatches(
  project: ArtifactProjectDeclaration<string, any, any>,
  files: readonly SourceFile[],
  activeFormat: SchemaIdeDocumentFormat,
) {
  return files
    .flatMap((file) => {
      const routes = projectFileRoutes(project, file.path);
      return routes.length
        ? routes.map((route) => ({
            path: file.path,
            schemaId: route.schema ? routeSchemaId(route) : null,
            format: formatForPath(file.path, activeFormat),
          }))
        : [
            {
              path: file.path,
              schemaId: null,
              format: formatForPath(file.path, activeFormat),
            },
          ];
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function routeReflectionAttributes(route: ArtifactFileRoute) {
  return {
    workspaceField: routeWorkspaceField(route),
    ...(routeMode(route) === "file" ? { single: true } : {}),
    ...(routeMode(route) === "values" ? { values: true } : {}),
    ...(routeIndexBy(route) ? { indexBy: routeIndexBy(route) } : {}),
    ...(routeOptional(route) ? { optional: true } : {}),
  };
}

export function routeSchemaId(route: ArtifactFileRoute): string {
  return stringAttribute(route.metadata?.attributes ?? {}, "schemaId") ?? route.id;
}

export function routeWorkspaceField(route: ArtifactFileRoute): string {
  return (
    route.config?.workspaceField ??
    stringAttribute(route.metadata?.attributes ?? {}, "workspaceField") ??
    route.id
  );
}

export function routeMode(route: ArtifactFileRoute): "file" | "files" | "values" {
  if (route.config?.mode) return route.config.mode;
  const attributes = route.metadata?.attributes ?? {};
  return attributes["single"] === true
    ? "file"
    : attributes["values"] === true
      ? "values"
      : "files";
}

export function routeIndexBy(route: ArtifactFileRoute): string | undefined {
  return route.config?.indexBy ?? stringAttribute(route.metadata?.attributes ?? {}, "indexBy");
}

export function routeDescription(route: ArtifactFileRoute): string | undefined {
  return (
    route.config?.description ?? stringAttribute(route.metadata?.attributes ?? {}, "description")
  );
}

export function routeOptional(route: ArtifactFileRoute): boolean {
  return route.config?.optional ?? route.metadata?.attributes?.["optional"] === true;
}

function projectFileRoutes(
  project: ArtifactProjectDeclaration<string, any, any>,
  path: string,
): readonly ArtifactFileRoute[] {
  return project.route({ _tag: "ProjectFile", path });
}

function projectRouteValue(
  route: ArtifactFileRoute,
  files: readonly { readonly path: string; readonly value: unknown }[],
): unknown {
  if (routeMode(route) === "file") return files[0]?.value ?? null;
  const indexBy = routeIndexBy(route);
  if (indexBy) {
    const values = new Map<string, unknown>();
    for (const file of files) {
      if (isRecord(file.value) && typeof file.value[indexBy] === "string") {
        values.set(file.value[indexBy], file.value);
      }
    }
    return values;
  }
  if (routeMode(route) === "values") return files.map((file) => file.value);
  return files;
}

function isWorkspaceSidecarPath(path: string): boolean {
  return /\.(?:pdf|png|jpe?g|webp)$/i.test(path);
}

function stringAttribute(
  attributes: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = attributes[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === "object");
}
