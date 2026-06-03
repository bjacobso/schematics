import { Schema } from "effect";
import {
  ArtifactProject,
  ArtifactType,
  matchGlob,
  type ArtifactProjectDeclaration,
} from "@schematics/artifacts";
import { validateArtifactProjectValue } from "./artifact-project-validation";
import { formatForPath } from "./document-codec";
import { summarizeDiagnostics } from "./diagnostics";
import {
  reflectEffectSchema,
  sourceSchemaFromReflection,
  withWorkspaceRouteAttributes,
  workspaceRouteAttributesFromReflection,
  type ReflectedWorkspaceRouteAttributes,
} from "./reflection";
import type {
  AnySchema,
  ReflectedSchema,
  RouteMatch,
  SchematicsDiagnostic,
  SchematicsDocumentFormat,
  SourceFile,
  SourceTree,
  ValidationResult,
} from "./types";

export interface ProjectValidationIssue {
  readonly at: (documentPath: string, message: string, path?: string | null) => void;
}

export interface ProjectValidationContext {
  readonly files: readonly SourceFile[];
}

export interface FileEntry<A = unknown> {
  readonly path: string;
  readonly value: A;
}

export type ProjectRouteMap = Readonly<Record<string, unknown>>;

export type ProjectRoutes<S> =
  S extends ProjectSchema<unknown, infer Routes> ? Routes : ProjectRouteMap;

export type ProjectRouteId<S> = Extract<keyof ProjectRoutes<S>, string>;

export type ProjectRouteValue<S, Id extends ProjectRouteId<S>> = ProjectRoutes<S>[Id];

export interface ProjectSchema<A = unknown, Routes extends ProjectRouteMap = ProjectRouteMap> {
  readonly _tag: "ProjectSchema";
  readonly decode: (tree: SourceTree, options?: ProjectDecodeOptions) => ValidationResult<A>;
  readonly reflect: () => readonly ReflectedSchema[];
  readonly route: (
    files: readonly SourceFile[],
    options?: ProjectDecodeOptions,
  ) => readonly RouteMatch[];
  pipe(): ProjectSchema<A, Routes>;
  pipe<B, RoutesB extends ProjectRouteMap>(
    fn1: (schema: ProjectSchema<A, Routes>) => ProjectSchema<B, RoutesB>,
  ): ProjectSchema<B, RoutesB>;
  pipe<B, RoutesB extends ProjectRouteMap, C, RoutesC extends ProjectRouteMap>(
    fn1: (schema: ProjectSchema<A, Routes>) => ProjectSchema<B, RoutesB>,
    fn2: (schema: ProjectSchema<B, RoutesB>) => ProjectSchema<C, RoutesC>,
  ): ProjectSchema<C, RoutesC>;
  pipe<
    B,
    RoutesB extends ProjectRouteMap,
    C,
    RoutesC extends ProjectRouteMap,
    D,
    RoutesD extends ProjectRouteMap,
  >(
    fn1: (schema: ProjectSchema<A, Routes>) => ProjectSchema<B, RoutesB>,
    fn2: (schema: ProjectSchema<B, RoutesB>) => ProjectSchema<C, RoutesC>,
    fn3: (schema: ProjectSchema<C, RoutesC>) => ProjectSchema<D, RoutesD>,
  ): ProjectSchema<D, RoutesD>;
  pipe(...fns: readonly ((schema: any) => any)[]): ProjectSchema<unknown, ProjectRouteMap>;
}

export interface ProjectDecodeOptions {
  readonly defaultFormat?: SchematicsDocumentFormat | undefined;
}

interface FieldSchema<A, Routes extends ProjectRouteMap = ProjectRouteMap> {
  readonly id: string;
  readonly reflect: () => readonly ReflectedSchema[];
  readonly route: (
    files: readonly SourceFile[],
    options: Required<ProjectDecodeOptions>,
  ) => readonly RouteMatch[];
  pipe(): FieldSchema<A, Routes>;
  pipe<B, RoutesB extends ProjectRouteMap>(
    fn1: (schema: FieldSchema<A, Routes>) => FieldSchema<B, RoutesB>,
  ): FieldSchema<B, RoutesB>;
  pipe<B, RoutesB extends ProjectRouteMap, C, RoutesC extends ProjectRouteMap>(
    fn1: (schema: FieldSchema<A, Routes>) => FieldSchema<B, RoutesB>,
    fn2: (schema: FieldSchema<B, RoutesB>) => FieldSchema<C, RoutesC>,
  ): FieldSchema<C, RoutesC>;
  pipe<
    B,
    RoutesB extends ProjectRouteMap,
    C,
    RoutesC extends ProjectRouteMap,
    D,
    RoutesD extends ProjectRouteMap,
  >(
    fn1: (schema: FieldSchema<A, Routes>) => FieldSchema<B, RoutesB>,
    fn2: (schema: FieldSchema<B, RoutesB>) => FieldSchema<C, RoutesC>,
    fn3: (schema: FieldSchema<C, RoutesC>) => FieldSchema<D, RoutesD>,
  ): FieldSchema<D, RoutesD>;
  pipe(...fns: readonly ((schema: any) => any)[]): FieldSchema<unknown, ProjectRouteMap>;
}

interface MatchedFile<A> {
  readonly path: string;
  readonly value: A;
}

type FieldShape = Record<string, FieldSchema<unknown, ProjectRouteMap>>;
type StructValue<Fields extends FieldShape> = {
  readonly [K in keyof Fields]: Fields[K] extends FieldSchema<infer A, ProjectRouteMap> ? A : never;
};
type FieldRoutes<Field> =
  Field extends FieldSchema<unknown, infer Routes> ? Routes : ProjectRouteMap;
type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;
type StructRoutes<Fields extends FieldShape> =
  UnionToIntersection<FieldRoutes<Fields[keyof Fields]>> extends infer Routes
    ? Routes extends ProjectRouteMap
      ? Routes
      : ProjectRouteMap
    : ProjectRouteMap;
type RenameRoutes<Routes extends ProjectRouteMap, Id extends string> = Record<
  Id,
  Routes[keyof Routes]
>;

type ProjectValidator<A> = (
  value: A,
  issue: ProjectValidationIssue,
  context: ProjectValidationContext,
) => void | Promise<void>;

const ProjectCompatibilityFileArtifact = ArtifactType.make("schematics.project-file");

interface FileSetOptions {
  readonly id?: string | undefined;
  readonly description?: string | undefined;
  readonly optional?: boolean | undefined;
}

class FileSetSchema<A, RouteId extends string> implements FieldSchema<
  readonly MatchedFile<A>[],
  Record<RouteId, A>
> {
  readonly id: string;

  constructor(
    readonly pattern: string,
    readonly schema: Schema.Schema<A>,
    readonly options: FileSetOptions = {},
  ) {
    this.id = options.id ?? pattern;
  }

  reflect(): readonly ReflectedSchema[] {
    return [
      withWorkspaceRouteAttributes(
        reflectEffectSchema({
          id: this.id,
          schema: this.schema as AnySchema,
          match: this.pattern,
          description: this.options.description,
        }),
        {
          ...(this.options.optional ? { optional: true } : {}),
        },
      ),
    ];
  }

  route(
    files: readonly SourceFile[],
    options: Required<ProjectDecodeOptions>,
  ): readonly RouteMatch[] {
    return files
      .filter((file) => matchGlob(this.pattern, file.path))
      .map((file) => ({
        path: file.path,
        schemaId: this.id,
        format: formatForPath(file.path, options.defaultFormat),
      }));
  }

  pipe<B>(...fns: readonly ((schema: any) => any)[]): FieldSchema<B, Record<RouteId, A>> {
    return pipeValue(this, fns) as FieldSchema<B, Record<RouteId, A>>;
  }
}

class MappedFieldSchema<A, B, Routes extends ProjectRouteMap> implements FieldSchema<B, Routes> {
  readonly id: string;

  constructor(
    readonly inner: FieldSchema<A, Routes>,
    readonly map: (value: A) => B,
    readonly routeAttributes: ReflectedWorkspaceRouteAttributes = {},
  ) {
    this.id = inner.id;
  }

  reflect(): readonly ReflectedSchema[] {
    return this.inner
      .reflect()
      .map((reflected) => withWorkspaceRouteAttributes(reflected, this.routeAttributes));
  }

  route(
    files: readonly SourceFile[],
    options: Required<ProjectDecodeOptions>,
  ): readonly RouteMatch[] {
    return this.inner.route(files, options);
  }

  pipe<C>(...fns: readonly ((schema: any) => any)[]): FieldSchema<C, Routes> {
    return pipeValue(this, fns) as FieldSchema<C, Routes>;
  }
}

class StructProjectSchema<Fields extends FieldShape> implements ProjectSchema<
  StructValue<Fields>,
  StructRoutes<Fields>
> {
  readonly _tag = "ProjectSchema" as const;

  constructor(
    private readonly fields: Fields,
    private readonly validators: readonly {
      readonly name: string;
      readonly validate: ProjectValidator<StructValue<Fields>>;
    }[] = [],
  ) {}

  decode(tree: SourceTree, options?: ProjectDecodeOptions): ValidationResult<StructValue<Fields>> {
    const resolvedOptions = resolveOptions(options);
    const routeValidation = validateArtifactProjectValue({
      project: createCompatibilityArtifactProject(this.reflect()),
      files: tree.files,
      activeFormat: resolvedOptions.defaultFormat ?? "json",
    });
    const diagnostics = [...routeValidation.diagnostics];
    const value = routeValidation.value;

    if (!diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      const issue: ProjectValidationIssue = {
        at: (documentPath, message, path = null) => {
          diagnostics.push(crossFileDiagnostic(tree.files, documentPath, message, path));
        },
      };

      for (const validator of this.validators) {
        try {
          const result = validator.validate(value as StructValue<Fields>, issue, {
            files: tree.files,
          });
          if (result instanceof Promise) {
            diagnostics.push({
              path: null,
              severity: "warning",
              source: "cross-file",
              message: `Async validator "${validator.name}" was skipped by the synchronous IDE validator`,
            });
          }
        } catch (error) {
          diagnostics.push({
            path: null,
            severity: "error",
            source: "cross-file",
            message:
              error instanceof Error
                ? `${validator.name}: ${error.message}`
                : `${validator.name}: validation failed`,
          });
        }
      }
    }

    return {
      value: diagnostics.some((diagnostic) => diagnostic.severity === "error")
        ? null
        : (value as StructValue<Fields>),
      diagnostics,
      summary: summarizeDiagnostics(diagnostics),
      routeMatches: routeValidation.routeMatches,
    };
  }

  reflect(): readonly ReflectedSchema[] {
    return Object.entries(this.fields).flatMap(([workspaceField, field]) =>
      field
        .reflect()
        .map((reflected) => withWorkspaceRouteAttributes(reflected, { workspaceField })),
    );
  }

  route(files: readonly SourceFile[], options?: ProjectDecodeOptions): readonly RouteMatch[] {
    const resolvedOptions = resolveOptions(options);
    const matches = Object.values(this.fields).flatMap((field) =>
      field.route(files, resolvedOptions),
    );
    const matchedPaths = new Set(matches.map((match) => match.path));

    return [
      ...matches,
      ...files
        .filter((file) => !matchedPaths.has(file.path))
        .map((file) => ({
          path: file.path,
          schemaId: null,
          format: formatForPath(file.path, resolvedOptions.defaultFormat),
        })),
    ].sort((left, right) => left.path.localeCompare(right.path));
  }

  pipe<B>(...fns: readonly ((schema: any) => any)[]): ProjectSchema<B, StructRoutes<Fields>> {
    return pipeValue(this, fns) as ProjectSchema<B, StructRoutes<Fields>>;
  }

  withValidator(
    name: string,
    validate: ProjectValidator<StructValue<Fields>>,
  ): StructProjectSchema<Fields> {
    return new StructProjectSchema(this.fields, [...this.validators, { name, validate }]);
  }
}

function createCompatibilityArtifactProject(reflectedRoutes: readonly ReflectedSchema[]) {
  let project = ArtifactProject.make("workspace-compat") as ArtifactProjectDeclaration<
    string,
    any,
    any
  >;

  for (const reflected of reflectedRoutes) {
    if (!reflected.match) continue;

    const sourceSchema = sourceSchemaFromReflection(reflected);
    const routeAttributes = workspaceRouteAttributesFromReflection(reflected);
    const routeMetadata = {
      attributes: {
        ...routeAttributes,
        schemaId: reflected.id,
        ...(reflected.title ? { title: reflected.title } : {}),
        ...(reflected.description ? { description: reflected.description } : {}),
        jsonSchema: reflected.jsonSchema,
      },
    };

    project = sourceSchema
      ? project.files(reflected.match, {
          id: reflected.id,
          type: ProjectCompatibilityFileArtifact,
          schema: sourceSchema,
          metadata: routeMetadata,
        })
      : project.files(reflected.match, ProjectCompatibilityFileArtifact, {
          id: reflected.id,
          metadata: routeMetadata,
        });
  }

  return project;
}

export function isProjectSchema(value: unknown): value is ProjectSchema<unknown> {
  return Boolean(
    value && typeof value === "object" && (value as { _tag?: unknown })._tag === "ProjectSchema",
  );
}

function projectAnnotations<const Id extends string>(annotations: {
  readonly identifier: Id;
  readonly description?: string | undefined;
}): <A, Routes extends ProjectRouteMap>(
  field: FieldSchema<A, Routes>,
) => FieldSchema<A, RenameRoutes<Routes, Id>>;
function projectAnnotations(annotations: {
  readonly identifier?: undefined;
  readonly description?: string | undefined;
}): <A, Routes extends ProjectRouteMap>(field: FieldSchema<A, Routes>) => FieldSchema<A, Routes>;
function projectAnnotations(annotations: {
  readonly identifier?: string | undefined;
  readonly description?: string | undefined;
}) {
  return <A, Routes extends ProjectRouteMap>(field: FieldSchema<A, Routes>) => {
    return annotateField(field, annotations);
  };
}

function annotateField<A, Routes extends ProjectRouteMap>(
  field: FieldSchema<A, Routes>,
  annotations: {
    readonly identifier?: string | undefined;
    readonly description?: string | undefined;
  },
): FieldSchema<A, ProjectRouteMap> {
  if (field instanceof FileSetSchema) {
    return new FileSetSchema(field.pattern, field.schema, {
      ...field.options,
      id: annotations.identifier ?? field.id,
      description: annotations.description,
    }) as unknown as FieldSchema<A, ProjectRouteMap>;
  }
  if (field instanceof MappedFieldSchema) {
    return new MappedFieldSchema(
      annotateField(field.inner, annotations),
      field.map,
      field.routeAttributes,
    );
  }
  return field;
}

export const Project = {
  /**
   * @deprecated Prefer ArtifactProject route declarations for new Schematics
   * projects. Project.Struct remains as a compatibility projection API.
   */
  Struct<const Fields extends FieldShape>(
    fields: Fields,
  ): ProjectSchema<StructValue<Fields>, StructRoutes<Fields>> {
    return new StructProjectSchema(fields);
  },

  /**
   * @deprecated Prefer ArtifactProject.files for new Schematics projects.
   * This helper remains for compatibility workspace schemas.
   */
  files<const Pattern extends string, A>(
    pattern: Pattern,
    schema: Schema.Schema<A>,
    options?: { readonly optional?: boolean },
  ): FieldSchema<readonly MatchedFile<A>[], Record<Pattern, A>> {
    return new FileSetSchema(pattern, schema, { optional: options?.optional });
  },

  /**
   * @deprecated Prefer ArtifactProject.files with route mode "file" for new
   * Schematics projects. This helper remains for compatibility workspace schemas.
   */
  file<const Path extends string, A>(
    path: Path,
    schema: Schema.Schema<A>,
    options?: { readonly optional?: boolean },
  ): FieldSchema<A | null, Record<Path, A>> {
    const field: FieldSchema<readonly MatchedFile<A>[], Record<Path, A>> = new FileSetSchema(
      path,
      schema,
      {
        optional: options?.optional,
      },
    );
    return new MappedFieldSchema(field, (files) => files[0]?.value ?? null, { single: true });
  },

  /**
   * @deprecated Prefer ArtifactProject route config indexBy metadata for new
   * Schematics projects. This helper remains for compatibility workspace schemas.
   */
  indexBy<A extends Record<PropertyKey, unknown>, K extends keyof A>(
    key: K,
  ): <Routes extends ProjectRouteMap>(
    field: FieldSchema<readonly MatchedFile<A>[], Routes>,
  ) => FieldSchema<Map<Extract<A[K], string>, A>, Routes> {
    return (field) =>
      new MappedFieldSchema(
        field,
        (files) => {
          const map = new Map<Extract<A[K], string>, A>();
          for (const file of files) {
            const mapKey = file.value[key];
            if (typeof mapKey === "string") {
              map.set(mapKey as Extract<A[K], string>, file.value);
            }
          }
          return map;
        },
        { indexBy: String(key) },
      );
  },

  /**
   * @deprecated Prefer ArtifactProject route config mode "values" for new
   * Schematics projects. This helper remains for compatibility workspace schemas.
   */
  values<A>(): <Routes extends ProjectRouteMap>(
    field: FieldSchema<readonly MatchedFile<A>[], Routes>,
  ) => FieldSchema<readonly A[], Routes> {
    return (field) =>
      new MappedFieldSchema(field, (files) => files.map((file) => file.value), { values: true });
  },

  annotations: projectAnnotations,

  /**
   * @deprecated Prefer artifact runtime projectDiagnostics or algebra
   * views for new Schematics projects. This helper remains for compatibility
   * workspace schemas.
   */
  validate<A>(
    name: string,
    validate: ProjectValidator<A>,
  ): <Routes extends ProjectRouteMap>(
    schema: ProjectSchema<A, Routes>,
  ) => ProjectSchema<A, Routes> {
    return (schema) => new ValidatedProjectSchema(schema, name, validate);
  },

  /**
   * @deprecated Prefer artifact-native validation views for new Schematics
   * projects. This helper remains for compatibility workspace schemas.
   */
  filter<A>(
    name: string,
    predicate: (value: A) => boolean,
    message: string | ((value: A) => string),
  ): <Routes extends ProjectRouteMap>(
    schema: ProjectSchema<A, Routes>,
  ) => ProjectSchema<A, Routes> {
    return Project.validate(name, (value, issue) => {
      if (!predicate(value)) {
        issue.at(name, typeof message === "function" ? message(value) : message);
      }
    });
  },

  /**
   * @deprecated Prefer artifact-native decoded views for new Schematics
   * projects. This helper remains for compatibility workspace schemas.
   */
  transform<A, B>(
    transform: (value: A) => B,
  ): <Routes extends ProjectRouteMap>(
    schema: ProjectSchema<A, Routes>,
  ) => ProjectSchema<B, Routes> {
    return (schema) => new TransformProjectSchema(schema, transform);
  },
};

class TransformProjectSchema<A, B, Routes extends ProjectRouteMap> implements ProjectSchema<
  B,
  Routes
> {
  readonly _tag = "ProjectSchema" as const;

  constructor(
    private readonly inner: ProjectSchema<A, Routes>,
    private readonly transform: (value: A) => B,
  ) {}

  decode(tree: SourceTree, options?: ProjectDecodeOptions): ValidationResult<B> {
    const result = this.inner.decode(tree, options);
    return {
      value: result.value === null ? null : this.transform(result.value),
      diagnostics: result.diagnostics,
      summary: result.summary,
      routeMatches: result.routeMatches,
    };
  }

  reflect(): readonly ReflectedSchema[] {
    return this.inner.reflect();
  }

  route(files: readonly SourceFile[], options?: ProjectDecodeOptions): readonly RouteMatch[] {
    return this.inner.route(files, options);
  }

  pipe<C>(...fns: readonly ((schema: any) => any)[]): ProjectSchema<C, Routes> {
    return pipeValue(this, fns) as ProjectSchema<C, Routes>;
  }
}

class ValidatedProjectSchema<A, Routes extends ProjectRouteMap> implements ProjectSchema<
  A,
  Routes
> {
  readonly _tag = "ProjectSchema" as const;

  constructor(
    private readonly inner: ProjectSchema<A, Routes>,
    private readonly name: string,
    private readonly validate: ProjectValidator<A>,
  ) {}

  decode(tree: SourceTree, options?: ProjectDecodeOptions): ValidationResult<A> {
    const result = this.inner.decode(tree, options);
    const diagnostics = [...result.diagnostics];

    if (
      result.value !== null &&
      !diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ) {
      const issue: ProjectValidationIssue = {
        at: (documentPath, message, path = null) => {
          diagnostics.push(crossFileDiagnostic(tree.files, documentPath, message, path));
        },
      };

      try {
        const validationResult = this.validate(result.value, issue, { files: tree.files });
        if (validationResult instanceof Promise) {
          diagnostics.push({
            path: null,
            severity: "warning",
            source: "cross-file",
            message: `Async validator "${this.name}" was skipped by the synchronous IDE validator`,
          });
        }
      } catch (error) {
        diagnostics.push({
          path: null,
          severity: "error",
          source: "cross-file",
          message:
            error instanceof Error
              ? `${this.name}: ${error.message}`
              : `${this.name}: validation failed`,
        });
      }
    }

    return {
      value: diagnostics.some((diagnostic) => diagnostic.severity === "error")
        ? null
        : result.value,
      diagnostics,
      summary: summarizeDiagnostics(diagnostics),
      routeMatches: result.routeMatches,
    };
  }

  reflect(): readonly ReflectedSchema[] {
    return this.inner.reflect();
  }

  route(files: readonly SourceFile[], options?: ProjectDecodeOptions): readonly RouteMatch[] {
    return this.inner.route(files, options);
  }

  pipe<B>(...fns: readonly ((schema: any) => any)[]): ProjectSchema<B, Routes> {
    return pipeValue(this, fns) as ProjectSchema<B, Routes>;
  }
}

function resolveOptions(options?: ProjectDecodeOptions): Required<ProjectDecodeOptions> {
  return { defaultFormat: options?.defaultFormat ?? "json" };
}

function pipeValue(value: unknown, fns: readonly ((schema: any) => any)[]): unknown {
  return fns.reduce((current, fn) => fn(current), value);
}

function crossFileDiagnostic(
  files: readonly SourceFile[],
  documentPath: string,
  message: string,
  path: string | null,
): SchematicsDiagnostic {
  const location = resolveCrossFileLocation(files, documentPath, message, path);
  return {
    path: location.path,
    documentPath,
    severity: "error",
    source: "cross-file",
    message,
    ...(location.line ? { line: location.line } : {}),
    ...(location.column ? { column: location.column } : {}),
  };
}

function resolveCrossFileLocation(
  files: readonly SourceFile[],
  documentPath: string,
  message: string,
  path: string | null,
): { readonly path: string | null; readonly line?: number; readonly column?: number } {
  const explicitFile = path ? files.find((file) => file.path === path) : undefined;
  const parts = documentPath.split(".").filter(Boolean);
  const collection = parts[0];
  const entityId = parts[1];
  const property = parts.at(-1);
  const candidates = explicitFile
    ? [explicitFile]
    : files.filter((file) => isLikelyDocumentPath(file.path, collection, entityId));
  const searchable = candidates.length ? candidates : files;

  if (entityId) {
    const entityCandidates = searchable.filter((file) =>
      fileContainsScalar(file.content, "id", entityId),
    );
    const entityLocation =
      locateProperty(entityCandidates, property) ?? locateScalar(entityCandidates, entityId);
    if (entityLocation) return entityLocation;
  }

  const propertyLocation = locateProperty(searchable, property);
  if (propertyLocation) return propertyLocation;

  const messageValue = message.split(":").at(-1)?.trim();
  if (messageValue) {
    const messageLocation = locateScalar(searchable, messageValue);
    if (messageLocation) return messageLocation;
  }

  return { path };
}

function isLikelyDocumentPath(
  path: string,
  collection: string | undefined,
  entityId: string | undefined,
): boolean {
  if (collection && (path === collection || path.startsWith(`${collection}/`))) return true;
  return Boolean(entityId && path.includes(entityId));
}

function locateProperty(
  files: readonly SourceFile[],
  property: string | undefined,
): { readonly path: string; readonly line: number; readonly column: number } | null {
  if (!property) return null;
  const jsonKey = `"${escapeRegExp(property)}"\\s*:`;
  const yamlKey = `${escapeRegExp(property)}\\s*:`;
  return locatePattern(files, new RegExp(`${jsonKey}|${yamlKey}`));
}

function locateScalar(
  files: readonly SourceFile[],
  value: string,
): { readonly path: string; readonly line: number; readonly column: number } | null {
  return locatePattern(files, new RegExp(escapeRegExp(value)));
}

function locatePattern(
  files: readonly SourceFile[],
  pattern: RegExp,
): { readonly path: string; readonly line: number; readonly column: number } | null {
  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const match = pattern.exec(lines[index] ?? "");
      if (match?.index !== undefined) {
        return { path: file.path, line: index + 1, column: match.index + 1 };
      }
    }
  }
  return null;
}

function fileContainsScalar(content: string, key: string, value: string): boolean {
  const escapedKey = escapeRegExp(key);
  const escapedValue = escapeRegExp(value);
  return (
    new RegExp(`"${escapedKey}"\\s*:\\s*"${escapedValue}"`).test(content) ||
    new RegExp(`${escapedKey}\\s*:\\s*${escapedValue}`).test(content)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
