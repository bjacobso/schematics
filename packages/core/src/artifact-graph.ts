import type { SchemaIdeInputSchema } from "./validation";
import type { WorkspaceRouteMap } from "./workspace-schema";
import type { SchemaIdeDocumentFormat, SourceFile } from "./types";

export type SchemaIdeArtifactKind = "source" | "generated";
export type SchemaIdeArtifactPolicy = "read-only" | "promotable" | "editable";
export type SchemaIdeToolAvailability = "runnable" | "blocked" | "unavailable";
export type SchemaIdeToolRunStatus = "running" | "passed" | "failed" | "skipped";
export type SchemaIdeArtifactStatusValue = "present" | "missing" | "stale" | "unmanaged";

export interface SchemaIdeWorkspaceArtifact {
  readonly id: string;
  readonly kind: SchemaIdeArtifactKind;
  readonly path: string | readonly string[];
  readonly entity?: readonly string[] | undefined;
  readonly description?: string | undefined;
  readonly contentType?: string | undefined;
  readonly schemaId?: string | undefined;
  readonly optional?: boolean | undefined;
  readonly policy?: SchemaIdeArtifactPolicy | undefined;
  readonly staleWhen?: readonly string[] | undefined;
}

export interface SchemaIdeWorkspaceTool {
  readonly id: string;
  readonly label?: string | undefined;
  readonly description?: string | undefined;
  readonly inputs?: readonly string[] | undefined;
  readonly outputs?: readonly string[] | undefined;
  readonly capability?: string | undefined;
  readonly parametersSchemaId?: string | undefined;
  readonly resultSchemaId?: string | undefined;
  readonly model?: boolean | undefined;
  readonly agentCallable?: boolean | undefined;
  readonly uiCallable?: boolean | undefined;
  readonly cliCallable?: boolean | undefined;
  readonly requiresApproval?: boolean | undefined;
  readonly destructive?: boolean | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface SchemaIdeWorkspaceConfig<
  A = unknown,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
> {
  readonly id?: string | undefined;
  readonly schema: SchemaIdeInputSchema<A, Routes>;
  readonly defaultFormat?: SchemaIdeDocumentFormat | undefined;
  readonly include?: readonly string[] | undefined;
  readonly exclude?: readonly string[] | undefined;
  readonly artifacts?: readonly SchemaIdeWorkspaceArtifact[] | undefined;
  readonly tools?: readonly SchemaIdeWorkspaceTool[] | undefined;
}

export interface SchemaIdeArtifactGraphNode {
  readonly id: string;
  readonly kind: "artifact" | "tool";
}

export interface SchemaIdeArtifactGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: "consumes" | "produces";
}

export interface SchemaIdeArtifactGraphDiagnostic {
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly id?: string | undefined;
}

export interface SchemaIdeArtifactGraph {
  readonly artifacts: readonly SchemaIdeWorkspaceArtifact[];
  readonly tools: readonly SchemaIdeWorkspaceTool[];
  readonly nodes: readonly SchemaIdeArtifactGraphNode[];
  readonly edges: readonly SchemaIdeArtifactGraphEdge[];
  readonly diagnostics: readonly SchemaIdeArtifactGraphDiagnostic[];
}

export interface SchemaIdeArtifactPathMatch {
  readonly artifactId: string;
  readonly path: string;
  readonly bindings: Readonly<Record<string, string>>;
}

export interface SchemaIdeArtifactFileMatches {
  readonly matches: readonly SchemaIdeArtifactPathMatch[];
  readonly byArtifactId: Readonly<Record<string, readonly SchemaIdeArtifactPathMatch[]>>;
}

export function deriveSchemaIdeArtifactGraph({
  artifacts = [],
  tools = [],
}: {
  readonly artifacts?: readonly SchemaIdeWorkspaceArtifact[] | undefined;
  readonly tools?: readonly SchemaIdeWorkspaceTool[] | undefined;
}): SchemaIdeArtifactGraph {
  const diagnostics: SchemaIdeArtifactGraphDiagnostic[] = [];
  const artifactIds = new Set<string>();
  const toolIds = new Set<string>();

  for (const artifact of artifacts) {
    if (artifactIds.has(artifact.id)) {
      diagnostics.push({
        severity: "error",
        id: artifact.id,
        message: `Duplicate artifact id: ${artifact.id}`,
      });
    }
    artifactIds.add(artifact.id);

    for (const entity of artifact.entity ?? []) {
      if (!artifactPathTemplates(artifact).some((template) => template.includes(`:${entity}`))) {
        diagnostics.push({
          severity: "warning",
          id: artifact.id,
          message: `Artifact entity "${entity}" is not captured by any path template`,
        });
      }
    }
  }

  for (const tool of tools) {
    if (toolIds.has(tool.id)) {
      diagnostics.push({
        severity: "error",
        id: tool.id,
        message: `Duplicate tool id: ${tool.id}`,
      });
    }
    toolIds.add(tool.id);

    for (const input of tool.inputs ?? []) {
      if (!artifactIds.has(input)) {
        diagnostics.push({
          severity: "error",
          id: tool.id,
          message: `Tool ${tool.id} references unknown input artifact: ${input}`,
        });
      }
    }
    for (const output of tool.outputs ?? []) {
      if (!artifactIds.has(output)) {
        diagnostics.push({
          severity: "error",
          id: tool.id,
          message: `Tool ${tool.id} references unknown output artifact: ${output}`,
        });
      }
    }
  }

  return {
    artifacts,
    tools,
    nodes: [
      ...artifacts.map((artifact) => ({ id: artifact.id, kind: "artifact" as const })),
      ...tools.map((tool) => ({ id: tool.id, kind: "tool" as const })),
    ],
    edges: tools.flatMap((tool) => [
      ...(tool.inputs ?? []).map((input) => ({
        from: input,
        to: tool.id,
        kind: "consumes" as const,
      })),
      ...(tool.outputs ?? []).map((output) => ({
        from: tool.id,
        to: output,
        kind: "produces" as const,
      })),
    ]),
    diagnostics,
  };
}

export function matchSchemaIdeArtifactFiles({
  artifacts = [],
  files,
}: {
  readonly artifacts?: readonly SchemaIdeWorkspaceArtifact[] | undefined;
  readonly files: readonly SourceFile[];
}): SchemaIdeArtifactFileMatches {
  const matches: SchemaIdeArtifactPathMatch[] = [];

  for (const file of files) {
    for (const artifact of artifacts) {
      const bindings = matchArtifactPath(artifact, file.path);
      if (!bindings) continue;
      matches.push({ artifactId: artifact.id, path: file.path, bindings });
    }
  }

  const byArtifactId: Record<string, SchemaIdeArtifactPathMatch[]> = {};
  for (const artifact of artifacts) byArtifactId[artifact.id] = [];
  for (const match of matches) {
    (byArtifactId[match.artifactId] ??= []).push(match);
  }

  return { matches, byArtifactId };
}

export function artifactPathToGlob(path: string): string {
  return path
    .split("/")
    .map((segment) => (segment.startsWith(":") ? "*" : segment))
    .join("/");
}

export function artifactGlobs(
  artifacts: readonly SchemaIdeWorkspaceArtifact[] | undefined,
): readonly string[] {
  return (artifacts ?? []).flatMap((artifact) =>
    artifactPathTemplates(artifact).map(artifactPathToGlob),
  );
}

function matchArtifactPath(
  artifact: SchemaIdeWorkspaceArtifact,
  path: string,
): Readonly<Record<string, string>> | null {
  for (const template of artifactPathTemplates(artifact)) {
    const bindings = matchPathTemplate(template, path);
    if (!bindings) continue;
    return Object.fromEntries(
      Object.entries(bindings).filter(([key]) => !artifact.entity || artifact.entity.includes(key)),
    );
  }
  return null;
}

function artifactPathTemplates(artifact: SchemaIdeWorkspaceArtifact): readonly string[] {
  return typeof artifact.path === "string" ? [artifact.path] : artifact.path;
}

function matchPathTemplate(template: string, path: string): Record<string, string> | null {
  const templateParts = template.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (templateParts.length !== pathParts.length) return null;

  const bindings: Record<string, string> = {};
  for (let index = 0; index < templateParts.length; index += 1) {
    const templatePart = templateParts[index]!;
    const pathPart = pathParts[index]!;

    if (templatePart.startsWith(":")) {
      const name = templatePart.slice(1);
      if (!name) return null;
      bindings[name] = pathPart;
      continue;
    }

    if (!segmentPattern(templatePart).test(pathPart)) return null;
  }

  return bindings;
}

function segmentPattern(segment: string): RegExp {
  const escaped = segment
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${escaped}$`);
}
