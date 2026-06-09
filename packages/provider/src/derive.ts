import { Relation, validateRelations, type RelationDiagnostic } from "@schematics/algebra";
import type { AnyArtifactType, ArtifactProjectDeclaration } from "@schematics/artifacts";
import {
  ArtifactProject,
  Project,
  SchematicsProjectFileArtifact,
  type ProjectSchema,
  type SchematicsDiagnostic,
  type SourceFile,
} from "@schematics/core";
import { Schema } from "effect";
import type { NormalizedResource } from "./resource";

export interface DeriveArtifactProjectOptions {
  readonly id: string;
  readonly resources: readonly NormalizedResource[];
  readonly include?: readonly string[] | undefined;
  readonly metadata?: readonly string[] | undefined;
  readonly secret?: readonly string[] | undefined;
}

/**
 * Build the schema-routed artifact project from a resource set — one `.files()`
 * route per resource, mirroring a hand-written `ArtifactProject.make(...).files(...)`.
 */
export function deriveArtifactProject(
  options: DeriveArtifactProjectOptions,
): ArtifactProjectDeclaration<string, any, any> {
  const config: Record<string, unknown> = {};
  if (options.include) config["include"] = options.include;
  if (options.metadata) config["metadata"] = options.metadata;
  if (options.secret) config["secret"] = options.secret;

  let project: any = (ArtifactProject as any).make(options.id, config);
  for (const resource of options.resources) {
    project = project.files(resource.route, {
      id: resource.schemaId,
      type: resource.artifactType ?? (SchematicsProjectFileArtifact as unknown as AnyArtifactType),
      schema: resource.schema,
      metadata: {
        attributes: {
          schemaId: resource.schemaId,
          workspaceField: resource.workspaceField,
          ...(resource.single ? { single: true } : { values: true }),
          format: resource.format,
          ...(resource.description ? { description: resource.description } : {}),
        },
      },
    });
  }
  return project as ArtifactProjectDeclaration<string, any, any>;
}

/**
 * The whole-workspace value the relation graph is built from: one struct field
 * per resource (`single ⇒ NullOr(schema)`, else `Array(schema)`).
 */
export function deriveWorkspaceSchema(
  resources: readonly NormalizedResource[],
): Schema.Schema<any> {
  const fields: Record<string, Schema.Schema<any>> = {};
  for (const resource of resources) {
    fields[resource.workspaceField] = resource.single
      ? Schema.NullOr(resource.schema)
      : Schema.Array(resource.schema);
  }
  return Schema.Struct(fields) as unknown as Schema.Schema<any>;
}

export interface WorkspaceDiagnosticsOptions {
  /** Override the message for a relation diagnostic (return `undefined` to keep the default). */
  readonly message?: ((diagnostic: RelationDiagnostic) => string | undefined) | undefined;
  /** Document path to attribute root-level diagnostics to. Default: the single resource's field. */
  readonly fallbackDocument?: string | undefined;
}

/**
 * Cross-file workspace diagnostics: wrap the generic `validateRelations` with
 * friendly messages and a kind→document-path mapping derived from the resources.
 */
export function deriveWorkspaceDiagnostics(
  workspaceSchema: Schema.Schema<any>,
  resources: readonly NormalizedResource[],
  options: WorkspaceDiagnosticsOptions = {},
): (workspace: any, files?: readonly SourceFile[]) => readonly SchematicsDiagnostic[] {
  const fieldByKind: Record<string, string | undefined> = {};
  for (const resource of resources) fieldByKind[resource.kind] = resource.workspaceField;
  const fallback = options.fallbackDocument ?? defaultDocument(resources);

  return (workspace) => {
    const diagnostics: SchematicsDiagnostic[] = [];
    for (const diagnostic of validateRelations(workspaceSchema as any, workspace)) {
      diagnostics.push({
        path: diagnostic.path.length > 0 ? Relation.key(diagnostic.path).join(".") : null,
        documentPath: documentPathFor(diagnostic, fieldByKind, fallback),
        severity: diagnostic.severity === "warning" ? "warning" : "error",
        source: "cross-file",
        message: options.message?.(diagnostic) ?? friendlyMessage(diagnostic),
      });
    }
    return diagnostics;
  };
}

/** The full project schema: routed shape + cross-file relation diagnostics. */
export function deriveProjectSchema(
  artifactProject: ArtifactProjectDeclaration<string, any, any>,
  workspaceSchema: Schema.Schema<any>,
  resources: readonly NormalizedResource[],
  options: WorkspaceDiagnosticsOptions & { readonly label?: string | undefined } = {},
): ProjectSchema<any> {
  const validate = deriveWorkspaceDiagnostics(workspaceSchema, resources, options);
  const fallback = options.fallbackDocument ?? defaultDocument(resources);
  return (Project.fromArtifactProject(artifactProject) as any).pipe(
    Project.validate(
      options.label ?? "references resolve",
      (workspace: any, issue: any, context: { readonly files: readonly SourceFile[] }) => {
        for (const diagnostic of validate(workspace, context.files)) {
          issue.at(diagnostic.documentPath ?? fallback, diagnostic.message, diagnostic.path);
        }
      },
    ),
  ) as ProjectSchema<any>;
}

function defaultDocument(resources: readonly NormalizedResource[]): string {
  return (
    resources.find((resource) => resource.single)?.workspaceField ??
    resources[0]?.workspaceField ??
    "workspace"
  );
}

function friendlyMessage(diagnostic: RelationDiagnostic): string {
  const relation = diagnostic.relation as any;
  if (diagnostic.code === "unresolved-ref" && "target" in relation) {
    return `Unknown ${relation.target}: ${relation.id}`;
  }
  if (diagnostic.code === "duplicate-id" && "type" in relation) {
    return `Duplicate ${relation.type} id: ${relation.id}`;
  }
  return diagnostic.message;
}

function documentPathFor(
  diagnostic: RelationDiagnostic,
  fieldByKind: Record<string, string | undefined>,
  fallback: string,
): string {
  const relation = diagnostic.relation as any;
  const kind = "target" in relation ? relation.target : relation.type;
  const field = fieldByKind[kind];
  if (field && "id" in relation) return `${field}.${relation.id}`;
  return diagnostic.path.length > 0 ? diagnostic.path.join(".") : fallback;
}
