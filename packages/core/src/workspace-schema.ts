import { Result, Schema, SchemaIssue } from "effect";
import { codecForPath, formatForPath } from "./document-codec";
import { parseErrorToDiagnostics, summarizeDiagnostics } from "./diagnostics";
import { reflectEffectSchema } from "./reflection";
import type {
  AnySchema,
  ReflectedSchema,
  RouteMatch,
  SchemaIdeDiagnostic,
  SchemaIdeDocumentFormat,
  SourceFile,
  SourceTree,
  ValidationResult,
} from "./types";

export interface WorkspaceValidationIssue {
  readonly at: (documentPath: string, message: string, path?: string | null) => void;
}

export interface WorkspaceValidationContext {
  readonly files: readonly SourceFile[];
}

export interface FileEntry<A = unknown> {
  readonly path: string;
  readonly value: A;
}

export type WorkspaceRouteMap = Readonly<Record<string, unknown>>;

export type WorkspaceRoutes<S> =
  S extends WorkspaceSchema<unknown, infer Routes> ? Routes : WorkspaceRouteMap;

export type WorkspaceRouteId<S> = Extract<keyof WorkspaceRoutes<S>, string>;

export type WorkspaceRouteValue<S, Id extends WorkspaceRouteId<S>> = WorkspaceRoutes<S>[Id];

export interface WorkspaceSchema<
  A = unknown,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
> {
  readonly _tag: "WorkspaceSchema";
  readonly decode: (tree: SourceTree, options?: WorkspaceDecodeOptions) => ValidationResult<A>;
  readonly reflect: () => readonly ReflectedSchema[];
  readonly route: (
    files: readonly SourceFile[],
    options?: WorkspaceDecodeOptions,
  ) => readonly RouteMatch[];
  pipe(): WorkspaceSchema<A, Routes>;
  pipe<B, RoutesB extends WorkspaceRouteMap>(
    fn1: (schema: WorkspaceSchema<A, Routes>) => WorkspaceSchema<B, RoutesB>,
  ): WorkspaceSchema<B, RoutesB>;
  pipe<B, RoutesB extends WorkspaceRouteMap, C, RoutesC extends WorkspaceRouteMap>(
    fn1: (schema: WorkspaceSchema<A, Routes>) => WorkspaceSchema<B, RoutesB>,
    fn2: (schema: WorkspaceSchema<B, RoutesB>) => WorkspaceSchema<C, RoutesC>,
  ): WorkspaceSchema<C, RoutesC>;
  pipe<
    B,
    RoutesB extends WorkspaceRouteMap,
    C,
    RoutesC extends WorkspaceRouteMap,
    D,
    RoutesD extends WorkspaceRouteMap,
  >(
    fn1: (schema: WorkspaceSchema<A, Routes>) => WorkspaceSchema<B, RoutesB>,
    fn2: (schema: WorkspaceSchema<B, RoutesB>) => WorkspaceSchema<C, RoutesC>,
    fn3: (schema: WorkspaceSchema<C, RoutesC>) => WorkspaceSchema<D, RoutesD>,
  ): WorkspaceSchema<D, RoutesD>;
  pipe(...fns: readonly ((schema: any) => any)[]): WorkspaceSchema<unknown, WorkspaceRouteMap>;
}

export interface WorkspaceDecodeOptions {
  readonly defaultFormat?: SchemaIdeDocumentFormat | undefined;
}

interface FieldSchema<A, Routes extends WorkspaceRouteMap = WorkspaceRouteMap> {
  readonly id: string;
  readonly decode: (
    files: readonly SourceFile[],
    usedPaths: Set<string>,
    options: Required<WorkspaceDecodeOptions>,
  ) => FieldDecodeResult<A>;
  readonly reflect: () => readonly ReflectedSchema[];
  readonly route: (
    files: readonly SourceFile[],
    options: Required<WorkspaceDecodeOptions>,
  ) => readonly RouteMatch[];
  pipe(): FieldSchema<A, Routes>;
  pipe<B, RoutesB extends WorkspaceRouteMap>(
    fn1: (schema: FieldSchema<A, Routes>) => FieldSchema<B, RoutesB>,
  ): FieldSchema<B, RoutesB>;
  pipe<B, RoutesB extends WorkspaceRouteMap, C, RoutesC extends WorkspaceRouteMap>(
    fn1: (schema: FieldSchema<A, Routes>) => FieldSchema<B, RoutesB>,
    fn2: (schema: FieldSchema<B, RoutesB>) => FieldSchema<C, RoutesC>,
  ): FieldSchema<C, RoutesC>;
  pipe<
    B,
    RoutesB extends WorkspaceRouteMap,
    C,
    RoutesC extends WorkspaceRouteMap,
    D,
    RoutesD extends WorkspaceRouteMap,
  >(
    fn1: (schema: FieldSchema<A, Routes>) => FieldSchema<B, RoutesB>,
    fn2: (schema: FieldSchema<B, RoutesB>) => FieldSchema<C, RoutesC>,
    fn3: (schema: FieldSchema<C, RoutesC>) => FieldSchema<D, RoutesD>,
  ): FieldSchema<D, RoutesD>;
  pipe(...fns: readonly ((schema: any) => any)[]): FieldSchema<unknown, WorkspaceRouteMap>;
}

interface FieldDecodeResult<A> {
  readonly value: A;
  readonly diagnostics: readonly SchemaIdeDiagnostic[];
}

interface MatchedFile<A> {
  readonly path: string;
  readonly value: A;
}

type FieldShape = Record<string, FieldSchema<unknown, WorkspaceRouteMap>>;
type StructValue<Fields extends FieldShape> = {
  readonly [K in keyof Fields]: Fields[K] extends FieldSchema<infer A, WorkspaceRouteMap>
    ? A
    : never;
};
type FieldRoutes<Field> =
  Field extends FieldSchema<unknown, infer Routes> ? Routes : WorkspaceRouteMap;
type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;
type StructRoutes<Fields extends FieldShape> =
  UnionToIntersection<FieldRoutes<Fields[keyof Fields]>> extends infer Routes
    ? Routes extends WorkspaceRouteMap
      ? Routes
      : WorkspaceRouteMap
    : WorkspaceRouteMap;
type RenameRoutes<Routes extends WorkspaceRouteMap, Id extends string> = Record<
  Id,
  Routes[keyof Routes]
>;

type WorkspaceValidator<A> = (
  value: A,
  issue: WorkspaceValidationIssue,
  context: WorkspaceValidationContext,
) => void | Promise<void>;

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

  decode(
    files: readonly SourceFile[],
    usedPaths: Set<string>,
    options: Required<WorkspaceDecodeOptions>,
  ): FieldDecodeResult<readonly MatchedFile<A>[]> {
    const matches = files.filter((file) => matchGlob(this.pattern, file.path));
    const diagnostics: SchemaIdeDiagnostic[] = [];
    const values: MatchedFile<A>[] = [];

    if (matches.length === 0 && !this.options.optional) {
      diagnostics.push({
        path: null,
        severity: "error",
        source: "workspace",
        message: `No files matched ${this.pattern}`,
      });
    }

    for (const file of matches) {
      usedPaths.add(file.path);
      const codec = codecForPath(file.path, options.defaultFormat);
      const parsed = codec.parse(file.content, file.path);
      if (!parsed.success) {
        diagnostics.push(parsed.diagnostic);
        continue;
      }

      const decoded = Schema.decodeUnknownResult(this.schema as never)(
        parsed.value,
      ) as unknown as Result.Result<A, SchemaIssue.Issue>;
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

      values.push({ path: file.path, value: decoded.success });
    }

    return { value: values, diagnostics };
  }

  reflect(): readonly ReflectedSchema[] {
    return [
      reflectEffectSchema({
        id: this.id,
        schema: this.schema as AnySchema,
        match: this.pattern,
        description: this.options.description,
      }),
    ];
  }

  route(
    files: readonly SourceFile[],
    options: Required<WorkspaceDecodeOptions>,
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

class MappedFieldSchema<A, B, Routes extends WorkspaceRouteMap> implements FieldSchema<B, Routes> {
  readonly id: string;

  constructor(
    readonly inner: FieldSchema<A, Routes>,
    readonly map: (value: A) => B,
  ) {
    this.id = inner.id;
  }

  decode(
    files: readonly SourceFile[],
    usedPaths: Set<string>,
    options: Required<WorkspaceDecodeOptions>,
  ): FieldDecodeResult<B> {
    const result = this.inner.decode(files, usedPaths, options);
    return {
      value: this.map(result.value),
      diagnostics: result.diagnostics,
    };
  }

  reflect(): readonly ReflectedSchema[] {
    return this.inner.reflect();
  }

  route(
    files: readonly SourceFile[],
    options: Required<WorkspaceDecodeOptions>,
  ): readonly RouteMatch[] {
    return this.inner.route(files, options);
  }

  pipe<C>(...fns: readonly ((schema: any) => any)[]): FieldSchema<C, Routes> {
    return pipeValue(this, fns) as FieldSchema<C, Routes>;
  }
}

class StructWorkspaceSchema<Fields extends FieldShape> implements WorkspaceSchema<
  StructValue<Fields>,
  StructRoutes<Fields>
> {
  readonly _tag = "WorkspaceSchema" as const;

  constructor(
    private readonly fields: Fields,
    private readonly validators: readonly {
      readonly name: string;
      readonly validate: WorkspaceValidator<StructValue<Fields>>;
    }[] = [],
  ) {}

  decode(
    tree: SourceTree,
    options?: WorkspaceDecodeOptions,
  ): ValidationResult<StructValue<Fields>> {
    const resolvedOptions = resolveOptions(options);
    const usedPaths = new Set<string>();
    const diagnostics: SchemaIdeDiagnostic[] = [];
    const value: Record<string, unknown> = {};

    for (const [key, field] of Object.entries(this.fields)) {
      const fieldResult = field.decode(tree.files, usedPaths, resolvedOptions);
      value[key] = fieldResult.value;
      diagnostics.push(...fieldResult.diagnostics);
    }

    for (const file of tree.files) {
      if (!usedPaths.has(file.path)) {
        if (isWorkspaceSidecarPath(file.path)) continue;
        diagnostics.push({
          path: file.path,
          severity: "warning",
          source: "workspace",
          message: "File did not match any workspace schema route",
        });
      }
    }

    if (!diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      const issue: WorkspaceValidationIssue = {
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
      routeMatches: this.route(tree.files, resolvedOptions),
    };
  }

  reflect(): readonly ReflectedSchema[] {
    return Object.values(this.fields).flatMap((field) => field.reflect());
  }

  route(files: readonly SourceFile[], options?: WorkspaceDecodeOptions): readonly RouteMatch[] {
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

  pipe<B>(...fns: readonly ((schema: any) => any)[]): WorkspaceSchema<B, StructRoutes<Fields>> {
    return pipeValue(this, fns) as WorkspaceSchema<B, StructRoutes<Fields>>;
  }

  withValidator(
    name: string,
    validate: WorkspaceValidator<StructValue<Fields>>,
  ): StructWorkspaceSchema<Fields> {
    return new StructWorkspaceSchema(this.fields, [...this.validators, { name, validate }]);
  }
}

export function isWorkspaceSchema(value: unknown): value is WorkspaceSchema<unknown> {
  return Boolean(
    value && typeof value === "object" && (value as { _tag?: unknown })._tag === "WorkspaceSchema",
  );
}

function workspaceAnnotations<const Id extends string>(annotations: {
  readonly identifier: Id;
  readonly description?: string | undefined;
}): <A, Routes extends WorkspaceRouteMap>(
  field: FieldSchema<A, Routes>,
) => FieldSchema<A, RenameRoutes<Routes, Id>>;
function workspaceAnnotations(annotations: {
  readonly identifier?: undefined;
  readonly description?: string | undefined;
}): <A, Routes extends WorkspaceRouteMap>(field: FieldSchema<A, Routes>) => FieldSchema<A, Routes>;
function workspaceAnnotations(annotations: {
  readonly identifier?: string | undefined;
  readonly description?: string | undefined;
}) {
  return <A, Routes extends WorkspaceRouteMap>(field: FieldSchema<A, Routes>) => {
    return annotateField(field, annotations);
  };
}

function annotateField<A, Routes extends WorkspaceRouteMap>(
  field: FieldSchema<A, Routes>,
  annotations: {
    readonly identifier?: string | undefined;
    readonly description?: string | undefined;
  },
): FieldSchema<A, WorkspaceRouteMap> {
  if (field instanceof FileSetSchema) {
    return new FileSetSchema(field.pattern, field.schema, {
      ...field.options,
      id: annotations.identifier ?? field.id,
      description: annotations.description,
    }) as unknown as FieldSchema<A, WorkspaceRouteMap>;
  }
  if (field instanceof MappedFieldSchema) {
    return new MappedFieldSchema(annotateField(field.inner, annotations), field.map);
  }
  return field;
}

export const Workspace = {
  Struct<const Fields extends FieldShape>(
    fields: Fields,
  ): WorkspaceSchema<StructValue<Fields>, StructRoutes<Fields>> {
    return new StructWorkspaceSchema(fields);
  },

  files<const Pattern extends string, A>(
    pattern: Pattern,
    schema: Schema.Schema<A>,
    options?: { readonly optional?: boolean },
  ): FieldSchema<readonly MatchedFile<A>[], Record<Pattern, A>> {
    return new FileSetSchema(pattern, schema, { optional: options?.optional });
  },

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
    return new MappedFieldSchema(field, (files) => files[0]?.value ?? null);
  },

  indexBy<A extends Record<PropertyKey, unknown>, K extends keyof A>(
    key: K,
  ): <Routes extends WorkspaceRouteMap>(
    field: FieldSchema<readonly MatchedFile<A>[], Routes>,
  ) => FieldSchema<Map<Extract<A[K], string>, A>, Routes> {
    return (field) =>
      new MappedFieldSchema(field, (files) => {
        const map = new Map<Extract<A[K], string>, A>();
        for (const file of files) {
          const mapKey = file.value[key];
          if (typeof mapKey === "string") {
            map.set(mapKey as Extract<A[K], string>, file.value);
          }
        }
        return map;
      });
  },

  values<A>(): <Routes extends WorkspaceRouteMap>(
    field: FieldSchema<readonly MatchedFile<A>[], Routes>,
  ) => FieldSchema<readonly A[], Routes> {
    return (field) => new MappedFieldSchema(field, (files) => files.map((file) => file.value));
  },

  annotations: workspaceAnnotations,

  validate<A>(
    name: string,
    validate: WorkspaceValidator<A>,
  ): <Routes extends WorkspaceRouteMap>(
    schema: WorkspaceSchema<A, Routes>,
  ) => WorkspaceSchema<A, Routes> {
    return (schema) => new ValidatedWorkspaceSchema(schema, name, validate);
  },

  filter<A>(
    name: string,
    predicate: (value: A) => boolean,
    message: string | ((value: A) => string),
  ): <Routes extends WorkspaceRouteMap>(
    schema: WorkspaceSchema<A, Routes>,
  ) => WorkspaceSchema<A, Routes> {
    return Workspace.validate(name, (value, issue) => {
      if (!predicate(value)) {
        issue.at(name, typeof message === "function" ? message(value) : message);
      }
    });
  },

  transform<A, B>(
    transform: (value: A) => B,
  ): <Routes extends WorkspaceRouteMap>(
    schema: WorkspaceSchema<A, Routes>,
  ) => WorkspaceSchema<B, Routes> {
    return (schema) => new TransformWorkspaceSchema(schema, transform);
  },
};

class TransformWorkspaceSchema<A, B, Routes extends WorkspaceRouteMap> implements WorkspaceSchema<
  B,
  Routes
> {
  readonly _tag = "WorkspaceSchema" as const;

  constructor(
    private readonly inner: WorkspaceSchema<A, Routes>,
    private readonly transform: (value: A) => B,
  ) {}

  decode(tree: SourceTree, options?: WorkspaceDecodeOptions): ValidationResult<B> {
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

  route(files: readonly SourceFile[], options?: WorkspaceDecodeOptions): readonly RouteMatch[] {
    return this.inner.route(files, options);
  }

  pipe<C>(...fns: readonly ((schema: any) => any)[]): WorkspaceSchema<C, Routes> {
    return pipeValue(this, fns) as WorkspaceSchema<C, Routes>;
  }
}

class ValidatedWorkspaceSchema<A, Routes extends WorkspaceRouteMap> implements WorkspaceSchema<
  A,
  Routes
> {
  readonly _tag = "WorkspaceSchema" as const;

  constructor(
    private readonly inner: WorkspaceSchema<A, Routes>,
    private readonly name: string,
    private readonly validate: WorkspaceValidator<A>,
  ) {}

  decode(tree: SourceTree, options?: WorkspaceDecodeOptions): ValidationResult<A> {
    const result = this.inner.decode(tree, options);
    const diagnostics = [...result.diagnostics];

    if (
      result.value !== null &&
      !diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ) {
      const issue: WorkspaceValidationIssue = {
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

  route(files: readonly SourceFile[], options?: WorkspaceDecodeOptions): readonly RouteMatch[] {
    return this.inner.route(files, options);
  }

  pipe<B>(...fns: readonly ((schema: any) => any)[]): WorkspaceSchema<B, Routes> {
    return pipeValue(this, fns) as WorkspaceSchema<B, Routes>;
  }
}

function resolveOptions(options?: WorkspaceDecodeOptions): Required<WorkspaceDecodeOptions> {
  return { defaultFormat: options?.defaultFormat ?? "json" };
}

function pipeValue(value: unknown, fns: readonly ((schema: any) => any)[]): unknown {
  return fns.reduce((current, fn) => fn(current), value);
}

function matchGlob(pattern: string, path: string): boolean {
  if (pattern === path) return true;

  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"))
    .join("[^/]*");

  return new RegExp(`^${escaped}$`).test(path);
}

function isWorkspaceSidecarPath(path: string): boolean {
  // Sidecar files are available to host/tooling workflows but are not decoded
  // as JSON/YAML schema documents by workspace routes.
  return /\.(?:pdf|png|jpe?g|webp)$/i.test(path);
}

function crossFileDiagnostic(
  files: readonly SourceFile[],
  documentPath: string,
  message: string,
  path: string | null,
): SchemaIdeDiagnostic {
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
