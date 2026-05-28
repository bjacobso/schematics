import { Effect, Schema } from "effect";
import {
  ArtifactHandler,
  ArtifactMatcher,
  ArtifactProject,
  ArtifactRegistry,
  ArtifactType,
  CachePolicy,
  Cost,
  createMemoryArtifactStore,
  type AnyArtifactType,
  type ArtifactContent,
  type ArtifactProjectDeclaration,
  type ArtifactRefDefinition,
  type ArtifactRegistryDeclaration,
  type ArtifactStore,
} from "@schema-ide/artifacts";
import {
  buildRelationGraph,
  validateRelations,
  type RelationDiagnostic,
  type RelationGraph,
} from "@schema-ide/schema-algebra";
import { formatForPath, parseDocument } from "./document-codec";
import { createReflection, validateSchemaIdeValue, type SchemaIdeInputSchema } from "./validation";
import { isWorkspaceSchema, type WorkspaceSchema } from "./workspace-schema";
import type { AnySchema } from "./types";
import type {
  SchemaIdeDiagnostic,
  SchemaIdeDocumentFormat,
  SchemaIdeReflection,
  SourceFile,
  ValidationResult,
} from "./types";

const SchemaIdeArtifactErrorSchema = Schema.Struct({
  message: Schema.String,
});

const SchemaIdeValidationSummarySchema = Schema.Struct({
  valid: Schema.Boolean,
  errorCount: Schema.Number,
  warningCount: Schema.Number,
  infoCount: Schema.Number,
});

export interface SchemaIdeArtifactError {
  readonly message: string;
}

export interface SchemaIdeArtifactRuntime<A = unknown> {
  readonly project: ArtifactProjectDeclaration<string, any, any>;
  readonly store: ArtifactStore;
  readonly registry: ArtifactRegistryDeclaration<any>;
  readonly capabilities: ArtifactProjectDeclaration<string, any, any>["capabilities"];
  readonly view: ArtifactRegistryDeclaration["view"];
  readonly files: Effect.Effect<readonly SourceFile[], SchemaIdeArtifactError>;
  readonly validation: Effect.Effect<ValidationResult<A>, SchemaIdeArtifactError>;
  readonly reflection: Effect.Effect<SchemaIdeReflection, SchemaIdeArtifactError>;
  readonly relationGraph: Effect.Effect<RelationGraph, SchemaIdeArtifactError>;
  readonly relationDiagnostics: Effect.Effect<
    readonly RelationDiagnostic[],
    SchemaIdeArtifactError
  >;
  readonly preview: (
    files: readonly SourceFile[],
    activeFile?: string | null | undefined,
  ) => Effect.Effect<SchemaIdeReflection, SchemaIdeArtifactError>;
}

export interface CreateSchemaIdeArtifactRuntimeOptions<A = unknown> {
  readonly schema: SchemaIdeInputSchema<A>;
  readonly files: readonly SourceFile[];
  readonly activeFile: string | null;
  readonly activeFormat: SchemaIdeDocumentFormat;
  readonly workspaceId?: string | undefined;
  readonly store?: ArtifactStore | undefined;
  readonly relationSchema?: AnySchema | undefined;
  readonly relationValue?: ((value: A) => unknown) | undefined;
}

export interface CreateArtifactProjectFromWorkspaceOptions {
  readonly name?: string | undefined;
}

export const SchemaIdeWorkspaceFileArtifact = ArtifactType.make("schema-ide.workspace-file")
  .match(ArtifactMatcher.tag("WorkspaceFile"))
  .view("sourceText", {
    output: Schema.String,
    error: SchemaIdeArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.ref,
      mediaType: "text/plain",
    },
  })
  .view("parsedValue", {
    output: Schema.Unknown,
    error: SchemaIdeArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  })
  .view("jsonSchema", {
    output: Schema.NullOr(Schema.Unknown),
    error: SchemaIdeArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/schema+json",
    },
  })
  .view("diagnostics", {
    output: Schema.Array(Schema.Unknown),
    error: SchemaIdeArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  });

export const SchemaIdeArtifactProject = createSchemaIdeArtifactProject("schema-ide").files(
  "**",
  SchemaIdeWorkspaceFileArtifact as unknown as AnyArtifactType,
  { id: "files" },
);

export function createArtifactProjectFromWorkspace(
  schema: WorkspaceSchema<unknown>,
  { name = "schema-ide" }: CreateArtifactProjectFromWorkspaceOptions = {},
): ArtifactProjectDeclaration<string, any, any> {
  let project = createSchemaIdeArtifactProject(name) as ArtifactProjectDeclaration<
    string,
    any,
    any
  >;

  for (const reflected of schema.reflect()) {
    if (!reflected.match) continue;
    project = project.files(
      reflected.match,
      SchemaIdeWorkspaceFileArtifact as unknown as AnyArtifactType,
      {
        id: reflected.id,
        metadata: {
          attributes: {
            schemaId: reflected.id,
            ...(reflected.title ? { title: reflected.title } : {}),
            ...(reflected.description ? { description: reflected.description } : {}),
            jsonSchema: reflected.jsonSchema,
          },
        },
      },
    );
  }

  return project;
}

function createSchemaIdeArtifactProject(name: string) {
  return ArtifactProject.make(name)
    .view("decodedWorkspace", {
      output: Schema.NullOr(Schema.Unknown),
      error: SchemaIdeArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    })
    .view("diagnostics", {
      output: Schema.Array(Schema.Unknown),
      error: SchemaIdeArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    })
    .view("validationSummary", {
      output: SchemaIdeValidationSummarySchema,
      error: SchemaIdeArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    })
    .view("routeMatches", {
      output: Schema.Array(Schema.Unknown),
      error: SchemaIdeArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    })
    .view("reflection", {
      output: Schema.Unknown,
      error: SchemaIdeArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    })
    .view("relationGraph", {
      output: Schema.Struct({
        definitions: Schema.Array(Schema.Unknown),
        references: Schema.Array(Schema.Unknown),
      }),
      error: SchemaIdeArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    })
    .view("relationDiagnostics", {
      output: Schema.Array(Schema.Unknown),
      error: SchemaIdeArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    });
}

export function createSchemaIdeArtifactRuntime<A>({
  schema,
  files,
  activeFile,
  activeFormat,
  workspaceId,
  store = createMemoryArtifactStore({
    files: files.map((file) => ({
      path: file.path,
      content: file.content,
      ...(workspaceId ? { workspaceId } : {}),
    })),
  }),
  relationSchema = hasAst(schema) ? schema : undefined,
  relationValue = (value) => value,
}: CreateSchemaIdeArtifactRuntimeOptions<A>): SchemaIdeArtifactRuntime<A> {
  const project: ArtifactProjectDeclaration<string, any, any> = isWorkspaceSchema(schema)
    ? createArtifactProjectFromWorkspace(schema, { name: workspaceId ?? "schema-ide" })
    : SchemaIdeArtifactProject;
  const runtimeFiles = collectFiles(store);
  const runtimeValidation = runtimeFiles.pipe(
    Effect.map((currentFiles) =>
      validateSchemaIdeValue({
        schema,
        files: currentFiles,
        activeFile,
        activeFormat,
      }),
    ),
  );
  const runtimeReflection = Effect.gen(function* () {
    const currentFiles = yield* runtimeFiles;
    const validation = validateSchemaIdeValue({
      schema,
      files: currentFiles,
      activeFile,
      activeFormat,
    });
    return createReflection({
      schema,
      files: currentFiles,
      activeFile,
      activeFormat,
      validation,
    });
  });
  const runtimeRelationGraph = runtimeValidation.pipe(
    Effect.flatMap((validation) =>
      Effect.try({
        try: () =>
          validation.value === null || !relationSchema
            ? ({ definitions: [], references: [] } satisfies RelationGraph)
            : buildRelationGraph(relationSchema, relationValue(validation.value)),
        catch: toArtifactError,
      }),
    ),
  );
  const runtimeRelationDiagnostics = runtimeValidation.pipe(
    Effect.flatMap((validation) =>
      Effect.try({
        try: () =>
          validation.value === null || !relationSchema
            ? []
            : validateRelations(relationSchema, relationValue(validation.value)),
        catch: toArtifactError,
      }),
    ),
  );
  const preview = (
    previewFiles: readonly SourceFile[],
    previewActiveFile: string | null | undefined = activeFile,
  ): Effect.Effect<SchemaIdeReflection, SchemaIdeArtifactError> =>
    createSchemaIdeArtifactRuntime({
      schema,
      files: previewFiles,
      activeFile: previewActiveFile ?? null,
      activeFormat,
      ...(workspaceId ? { workspaceId } : {}),
      ...(relationSchema ? { relationSchema } : {}),
      relationValue,
    }).reflection;

  const registry = ArtifactRegistry.make(project.api)
    .addHandler(
      ArtifactHandler.make(SchemaIdeWorkspaceFileArtifact.view("sourceText"), ({ ref }) =>
        readWorkspaceFileText(store, ref),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdeWorkspaceFileArtifact.view("parsedValue"), ({ ref }) =>
        Effect.gen(function* () {
          const sourceText = yield* readWorkspaceFileText(store, ref);
          return yield* parseWorkspaceFile(sourceText, ref);
        }),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdeWorkspaceFileArtifact.view("jsonSchema"), ({ ref }) =>
        fileJsonSchema(runtimeReflection, ref),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdeWorkspaceFileArtifact.view("diagnostics"), ({ ref }) =>
        fileDiagnostics(runtimeValidation, ref),
      ),
    )
    .addHandler(
      ArtifactHandler.make(project.view("decodedWorkspace"), () =>
        runtimeValidation.pipe(Effect.map((validation) => validation.value)),
      ),
    )
    .addHandler(
      ArtifactHandler.make(project.view("diagnostics"), () =>
        runtimeValidation.pipe(Effect.map((validation) => validation.diagnostics)),
      ),
    )
    .addHandler(
      ArtifactHandler.make(project.view("validationSummary"), () =>
        runtimeValidation.pipe(Effect.map((validation) => validation.summary)),
      ),
    )
    .addHandler(
      ArtifactHandler.make(project.view("routeMatches"), () =>
        runtimeValidation.pipe(Effect.map((validation) => validation.routeMatches)),
      ),
    )
    .addHandler(ArtifactHandler.make(project.view("reflection"), () => runtimeReflection))
    .addHandler(ArtifactHandler.make(project.view("relationGraph"), () => runtimeRelationGraph))
    .addHandler(
      ArtifactHandler.make(project.view("relationDiagnostics"), () => runtimeRelationDiagnostics),
    );

  return {
    project,
    store,
    registry,
    capabilities: project.capabilities.bind(project),
    view: registry.view.bind(registry),
    files: runtimeFiles,
    validation: runtimeValidation,
    reflection: runtimeReflection,
    relationGraph: runtimeRelationGraph,
    relationDiagnostics: runtimeRelationDiagnostics,
    preview,
  };
}

function collectFiles(
  store: ArtifactStore,
): Effect.Effect<readonly SourceFile[], SchemaIdeArtifactError> {
  return Effect.gen(function* () {
    const refs = yield* store.list.pipe(Effect.mapError(toArtifactError));
    const files: SourceFile[] = [];

    for (const ref of refs) {
      if (ref._tag !== "WorkspaceFile") continue;
      const content = yield* store.read(ref).pipe(Effect.mapError(toArtifactError));
      files.push({ path: ref.path, content: contentToText(content) });
    }

    return files.sort((left, right) => left.path.localeCompare(right.path));
  });
}

function readWorkspaceFileText(
  store: ArtifactStore,
  ref: ArtifactRefDefinition,
): Effect.Effect<string, SchemaIdeArtifactError> {
  if (ref._tag !== "WorkspaceFile") {
    return Effect.fail({ message: `Expected WorkspaceFile ref, received ${ref._tag}` });
  }

  return store.read(ref).pipe(Effect.map(contentToText), Effect.mapError(toArtifactError));
}

function parseWorkspaceFile(
  sourceText: string,
  ref: ArtifactRefDefinition,
): Effect.Effect<unknown, SchemaIdeArtifactError> {
  if (ref._tag !== "WorkspaceFile") {
    return Effect.fail({ message: `Expected WorkspaceFile ref, received ${ref._tag}` });
  }

  const parsed = parseDocument(sourceText, formatForPath(ref.path), ref.path);
  return parsed.success
    ? Effect.succeed(parsed.value)
    : Effect.fail({ message: parsed.diagnostic.message });
}

function fileJsonSchema(
  reflection: Effect.Effect<SchemaIdeReflection, SchemaIdeArtifactError>,
  ref: ArtifactRefDefinition,
): Effect.Effect<unknown | null, SchemaIdeArtifactError> {
  if (ref._tag !== "WorkspaceFile") {
    return Effect.fail({ message: `Expected WorkspaceFile ref, received ${ref._tag}` });
  }

  return reflection.pipe(
    Effect.map((value) => {
      const route = value.routeMatches.find((candidate) => candidate.path === ref.path);
      const schema = route?.schemaId
        ? value.schemas.find((candidate) => candidate.id === route.schemaId)
        : null;
      return schema?.jsonSchema ?? null;
    }),
  );
}

function fileDiagnostics(
  validation: Effect.Effect<ValidationResult<unknown>, SchemaIdeArtifactError>,
  ref: ArtifactRefDefinition,
): Effect.Effect<readonly SchemaIdeDiagnostic[], SchemaIdeArtifactError> {
  if (ref._tag !== "WorkspaceFile") {
    return Effect.fail({ message: `Expected WorkspaceFile ref, received ${ref._tag}` });
  }

  return validation.pipe(
    Effect.map((value) =>
      value.diagnostics.filter(
        (diagnostic) => diagnostic.path === ref.path || diagnostic.path === null,
      ),
    ),
  );
}

function contentToText(content: ArtifactContent): string {
  return typeof content === "string" ? content : new TextDecoder().decode(content);
}

function toArtifactError(error: unknown): SchemaIdeArtifactError {
  if (typeof error === "object" && error !== null && "reason" in error) {
    return { message: `Artifact store ${String(error.reason)}` };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

function hasAst(value: unknown): value is AnySchema {
  return Boolean(value && typeof value === "object" && "ast" in value);
}

export type SchemaIdeArtifactProject = typeof SchemaIdeArtifactProject;
export type SchemaIdeWorkspaceFileArtifact = typeof SchemaIdeWorkspaceFileArtifact;
