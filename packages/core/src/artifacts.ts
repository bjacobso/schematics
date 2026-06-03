import { Effect, Result, Schema, SchemaIssue } from "effect";
import {
  ArtifactHandler,
  ArtifactMatcher,
  ArtifactProject,
  ArtifactRegistry,
  ArtifactType,
  CachePolicy,
  Cost,
  createMemoryArtifactCache,
  createMemoryArtifactStore,
  hashArtifactContent,
  type AnyArtifactType,
  type ArtifactCache,
  type ArtifactContent,
  type ArtifactContentHashResolver,
  type ArtifactFileRoute,
  type ArtifactProjectDeclaration,
  type ArtifactRefDefinition,
  type ArtifactRegistryError,
  type ArtifactRegistryDeclaration,
  type ArtifactStore,
  type ArtifactViewOptions,
} from "@schema-ide/artifacts";
import {
  routeDescription,
  routeIndexBy,
  routeMode,
  routeOptional,
  routeReflectionAttributes,
  routeSchemaId,
  routeWorkspaceField,
  validateArtifactProjectValue,
} from "./artifact-project-validation";
import {
  buildRelationGraph,
  buildEntityIndex,
  definitionLocations as relationDefinitionLocations,
  patchSuggestions as relationPatchSuggestions,
  referenceDiagnostics as relationReferenceDiagnostics,
  references as relationReferences,
  validateRelations,
  type RelationDefinition,
  type RelationDiagnostic,
  type RelationEntityIndex,
  type RelationGraph,
  type RelationPatchSuggestion,
  type RelationReference,
} from "@schema-ide/schema-algebra";
import { formatForPath, parseDocument } from "./document-codec";
import { summarizeDiagnostics } from "./diagnostics";
import {
  reflectEffectSchema,
  sourceSchemaFromReflection,
  withWorkspaceRouteAttributes,
  workspaceRouteAttributesFromReflection,
} from "./reflection";
import { inspectImage } from "./image";
import { extractPdfText, inspectPdf } from "./pdf";
import { createReflection, validateSchemaIdeValue, type SchemaIdeInputSchema } from "./validation";
import { Project, isProjectSchema, type ProjectSchema } from "./project-schema";
import type { AnySchema } from "./types";
import type {
  ReflectedSchema,
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

const SchemaIdeRelationGraphSchema = Schema.Struct({
  definitions: Schema.Array(Schema.Unknown),
  references: Schema.Array(Schema.Unknown),
});

const SchemaIdeRelationArraySchema = Schema.Array(Schema.Unknown);

export interface SchemaIdeArtifactError {
  readonly message: string;
}

export type {
  SchemaIdePdfField,
  SchemaIdePdfFieldType,
  SchemaIdePdfInspection,
  SchemaIdePdfPageGeometry,
  SchemaIdePdfPageText,
  SchemaIdePdfTextExtraction,
} from "./pdf";
export type { SchemaIdeImageFormat, SchemaIdeImageInspection } from "./image";

export interface SchemaIdeArtifactRuntime<A = unknown> {
  readonly project: ArtifactProjectDeclaration<string, any, any>;
  readonly store: ArtifactStore;
  readonly registry: ArtifactRegistryDeclaration<any>;
  readonly capabilities: ArtifactProjectDeclaration<string, any, any>["capabilities"];
  readonly view: (
    ref: ArtifactRefDefinition,
    viewName: string,
    input?: unknown,
    options?: ArtifactViewOptions,
  ) => Effect.Effect<unknown, ArtifactRegistryError | SchemaIdeArtifactError>;
  readonly files: Effect.Effect<readonly SourceFile[], SchemaIdeArtifactError>;
  readonly validation: Effect.Effect<ValidationResult<A>, SchemaIdeArtifactError>;
  readonly reflection: Effect.Effect<SchemaIdeReflection, SchemaIdeArtifactError>;
  readonly relationGraph: Effect.Effect<RelationGraph, SchemaIdeArtifactError>;
  readonly entityIndex: Effect.Effect<RelationEntityIndex, SchemaIdeArtifactError>;
  readonly definitionLocations: Effect.Effect<
    readonly RelationDefinition[],
    SchemaIdeArtifactError
  >;
  readonly references: Effect.Effect<readonly RelationReference[], SchemaIdeArtifactError>;
  readonly relationDiagnostics: Effect.Effect<
    readonly RelationDiagnostic[],
    SchemaIdeArtifactError
  >;
  readonly referenceDiagnostics: Effect.Effect<
    readonly RelationDiagnostic[],
    SchemaIdeArtifactError
  >;
  readonly patchSuggestions: Effect.Effect<
    readonly RelationPatchSuggestion[],
    SchemaIdeArtifactError
  >;
  readonly preview: (
    files: readonly SourceFile[],
    activeFile?: string | null | undefined,
  ) => Effect.Effect<SchemaIdeReflection, SchemaIdeArtifactError>;
}

export interface CreateSchemaIdeArtifactRuntimeOptions<A = unknown> {
  readonly schema?: SchemaIdeInputSchema<A> | undefined;
  readonly files: readonly SourceFile[];
  readonly activeFile: string | null;
  readonly activeFormat: SchemaIdeDocumentFormat;
  readonly project?: ArtifactProjectDeclaration<string, any, any> | undefined;
  readonly projectId?: string | undefined;
  readonly store?: ArtifactStore | undefined;
  /**
   * View-result cache honoring each view's `cache` annotation. Pass a shared
   * cache to let expensive `contentHash` views (e.g. PDF extraction) survive
   * across runtime instances/requests. Defaults to a fresh in-memory cache,
   * which still dedupes repeated view calls within a single runtime.
   */
  readonly cache?: ArtifactCache | undefined;
  readonly relationInputSchema?: SchemaIdeInputSchema<any> | undefined;
  readonly relationSchema?: AnySchema | undefined;
  readonly relationValue?: ((value: any) => unknown) | undefined;
  readonly projectDiagnostics?:
    | ((
        value: A,
        context: {
          readonly files: readonly SourceFile[];
          readonly activeFile: string | null;
          readonly activeFormat: SchemaIdeDocumentFormat;
        },
      ) => readonly SchemaIdeDiagnostic[])
    | undefined;
}

export type ValidateSchemaIdeArtifactsOptions<A = unknown> =
  CreateSchemaIdeArtifactRuntimeOptions<A>;

export interface CreateArtifactProjectFromProjectSchemaOptions {
  readonly name?: string | undefined;
}

export interface CreateProjectSchemaFromArtifactProjectOptions {
  readonly fieldName?: ((route: ArtifactFileRoute) => string) | undefined;
  readonly mode?: ((route: ArtifactFileRoute) => "file" | "files" | "values") | undefined;
  readonly annotations?:
    | ((route: ArtifactFileRoute) => {
        readonly identifier?: string | undefined;
        readonly description?: string | undefined;
      })
    | undefined;
  readonly indexBy?: ((route: ArtifactFileRoute) => string | undefined) | undefined;
}

export const SchemaIdeProjectFileArtifact = ArtifactType.make("schema-ide.project-file")
  .match(ArtifactMatcher.tag("ProjectFile"))
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
  })
  .view("relationGraph", {
    output: SchemaIdeRelationGraphSchema,
    error: SchemaIdeArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  })
  .view("entityIndex", {
    output: SchemaIdeRelationArraySchema,
    error: SchemaIdeArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  })
  .view("definitionLocations", {
    output: SchemaIdeRelationArraySchema,
    error: SchemaIdeArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  })
  .view("references", {
    output: SchemaIdeRelationArraySchema,
    error: SchemaIdeArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  })
  .view("relationDiagnostics", {
    output: SchemaIdeRelationArraySchema,
    error: SchemaIdeArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  })
  .view("referenceDiagnostics", {
    output: SchemaIdeRelationArraySchema,
    error: SchemaIdeArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  })
  .view("patchSuggestions", {
    output: SchemaIdeRelationArraySchema,
    error: SchemaIdeArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  });

const SchemaIdePdfInspectionSchema = Schema.Struct({
  kind: Schema.Literal("pdf"),
  path: Schema.String,
  byteLength: Schema.Number,
  headerVersion: Schema.NullOr(Schema.String),
  pageCount: Schema.Number,
  pages: Schema.Array(
    Schema.Struct({
      page: Schema.Number,
      width: Schema.Number,
      height: Schema.Number,
      rotation: Schema.Number,
    }),
  ),
  fields: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      type: Schema.Literals([
        "button",
        "checkbox",
        "dropdown",
        "option-list",
        "radio",
        "signature",
        "text",
        "unknown",
      ]),
      required: Schema.Boolean,
      readOnly: Schema.Boolean,
    }),
  ),
  hasXFA: Schema.Boolean,
  encrypted: Schema.Boolean,
});

const SchemaIdePdfTextExtractionSchema = Schema.Struct({
  kind: Schema.Literal("pdf-text"),
  path: Schema.String,
  pageCount: Schema.Number,
  pages: Schema.Array(Schema.Struct({ page: Schema.Number, text: Schema.String })),
  text: Schema.String,
  extractable: Schema.Boolean,
});

export const SchemaIdePdfArtifact = ArtifactType.make("schema-ide.pdf")
  .match(ArtifactMatcher.extension("pdf"))
  .match(ArtifactMatcher.mime("application/pdf"))
  .view("inspect", {
    output: SchemaIdePdfInspectionSchema,
    error: SchemaIdeArtifactErrorSchema,
    annotations: {
      // Real document parsing (pdf-lib) — heavier than a byte heuristic, so the
      // content-hash cache earns its keep here.
      cost: Cost.medium,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  })
  .view("extractText", {
    output: SchemaIdePdfTextExtractionSchema,
    error: SchemaIdeArtifactErrorSchema,
    annotations: {
      cost: Cost.high,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  });

const SchemaIdeImageInspectionSchema = Schema.Struct({
  kind: Schema.Literal("image"),
  path: Schema.String,
  format: Schema.Literals(["png", "jpeg", "gif", "webp", "bmp", "svg", "unknown"]),
  width: Schema.NullOr(Schema.Number),
  height: Schema.NullOr(Schema.Number),
  byteLength: Schema.Number,
});

export const SchemaIdeImageArtifact = ArtifactType.make("schema-ide.image")
  .match(ArtifactMatcher.extension(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]))
  .match(
    ArtifactMatcher.mime([
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/bmp",
      "image/svg+xml",
    ]),
  )
  .view("inspect", {
    output: SchemaIdeImageInspectionSchema,
    error: SchemaIdeArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  });

export const SchemaIdeArtifactProject = createSchemaIdeArtifactProject("schema-ide").files(
  "**",
  SchemaIdeProjectFileArtifact as unknown as AnyArtifactType,
  { id: "files" },
);

export function createArtifactProjectFromProjectSchema(
  schema: ProjectSchema<unknown>,
  { name = "schema-ide" }: CreateArtifactProjectFromProjectSchemaOptions = {},
): ArtifactProjectDeclaration<string, any, any> {
  let project = createSchemaIdeArtifactProject(name) as ArtifactProjectDeclaration<
    string,
    any,
    any
  >;

  for (const reflected of schema.reflect()) {
    if (!reflected.match) continue;
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
    const sourceSchema = sourceSchemaFromReflection(reflected);

    project = sourceSchema
      ? project.files(reflected.match, {
          type: SchemaIdeProjectFileArtifact as unknown as AnyArtifactType,
          schema: sourceSchema,
          id: reflected.id,
          metadata: routeMetadata,
        })
      : project.files(reflected.match, SchemaIdeProjectFileArtifact as unknown as AnyArtifactType, {
          id: reflected.id,
          metadata: routeMetadata,
        });
  }

  return project;
}

export function createProjectSchemaFromArtifactProject(
  project: ArtifactProjectDeclaration<string, any, any>,
  options: CreateProjectSchemaFromArtifactProjectOptions = {},
): ProjectSchema<Record<string, unknown>> {
  const fields: Record<string, unknown> = {};

  for (const route of project.routes) {
    if (!route.schema) continue;

    const attributes = route.metadata?.attributes ?? {};
    const fieldName = options.fieldName?.(route) ?? routeWorkspaceField(route);
    const optional = routeOptional(route);
    const annotations = options.annotations?.(route) ?? {};
    const identifier =
      annotations.identifier ??
      attributeString(attributes, "schemaId") ??
      attributeString(attributes, "identifier") ??
      route.id;
    const description = annotations.description ?? routeDescription(route);
    const indexBy = options.indexBy?.(route) ?? routeIndexBy(route);
    const mode = options.mode?.(route) ?? routeMode(route);

    let field =
      mode === "file"
        ? (Project.file(route.pattern, route.schema, { optional }) as any)
        : (Project.files(route.pattern, route.schema, { optional }) as any);
    field = field.pipe(Project.annotations({ identifier, description }));
    if (mode !== "file" && indexBy) {
      field = field.pipe(Project.indexBy(indexBy as never));
    } else if (mode === "values") {
      field = field.pipe(Project.values());
    }
    fields[fieldName] = field;
  }

  return Project.Struct(fields as never) as ProjectSchema<Record<string, unknown>>;
}

function createSchemaIdeArtifactProject(name: string) {
  return withSchemaIdeProjectViews(ArtifactProject.make(name));
}

function withSchemaIdeProjectViews(
  project: ArtifactProjectDeclaration<string, any, any>,
): ArtifactProjectDeclaration<string, any, any> {
  let next = project;
  if (!next.projectType.views["decodedWorkspace"]) {
    next = next.view("decodedWorkspace", {
      output: Schema.NullOr(Schema.Unknown),
      error: SchemaIdeArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    }) as ArtifactProjectDeclaration<string, any, any>;
  }
  if (!next.projectType.views["diagnostics"]) {
    next = next.view("diagnostics", {
      output: Schema.Array(Schema.Unknown),
      error: SchemaIdeArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    }) as ArtifactProjectDeclaration<string, any, any>;
  }
  if (!next.projectType.views["validationSummary"]) {
    next = next.view("validationSummary", {
      output: SchemaIdeValidationSummarySchema,
      error: SchemaIdeArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    }) as ArtifactProjectDeclaration<string, any, any>;
  }
  if (!next.projectType.views["routeMatches"]) {
    next = next.view("routeMatches", {
      output: Schema.Array(Schema.Unknown),
      error: SchemaIdeArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    }) as ArtifactProjectDeclaration<string, any, any>;
  }
  if (!next.projectType.views["reflection"]) {
    next = next.view("reflection", {
      output: Schema.Unknown,
      error: SchemaIdeArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    }) as ArtifactProjectDeclaration<string, any, any>;
  }
  if (!next.projectType.views["relationGraph"]) {
    next = next.view("relationGraph", {
      output: SchemaIdeRelationGraphSchema,
      error: SchemaIdeArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    }) as ArtifactProjectDeclaration<string, any, any>;
  }
  if (!next.projectType.views["entityIndex"]) {
    next = next.view("entityIndex", {
      output: SchemaIdeRelationArraySchema,
      error: SchemaIdeArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    }) as ArtifactProjectDeclaration<string, any, any>;
  }
  if (!next.projectType.views["definitionLocations"]) {
    next = next.view("definitionLocations", {
      output: SchemaIdeRelationArraySchema,
      error: SchemaIdeArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    }) as ArtifactProjectDeclaration<string, any, any>;
  }
  if (!next.projectType.views["references"]) {
    next = next.view("references", {
      output: SchemaIdeRelationArraySchema,
      error: SchemaIdeArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    }) as ArtifactProjectDeclaration<string, any, any>;
  }
  if (!next.projectType.views["relationDiagnostics"]) {
    next = next.view("relationDiagnostics", {
      output: SchemaIdeRelationArraySchema,
      error: SchemaIdeArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    }) as ArtifactProjectDeclaration<string, any, any>;
  }
  if (!next.projectType.views["referenceDiagnostics"]) {
    next = next.view("referenceDiagnostics", {
      output: SchemaIdeRelationArraySchema,
      error: SchemaIdeArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    }) as ArtifactProjectDeclaration<string, any, any>;
  }
  if (!next.projectType.views["patchSuggestions"]) {
    next = next.view("patchSuggestions", {
      output: SchemaIdeRelationArraySchema,
      error: SchemaIdeArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    }) as ArtifactProjectDeclaration<string, any, any>;
  }
  return next;
}

export function createSchemaIdeArtifactRuntime<A>(
  options: CreateSchemaIdeArtifactRuntimeOptions<A>,
): SchemaIdeArtifactRuntime<A> {
  const {
    schema,
    files,
    activeFile,
    activeFormat,
    project: configuredProject,
    projectId,
    relationInputSchema = schema,
    relationSchema = schema && hasAst(schema) ? schema : undefined,
    relationValue = (value) => value,
    projectDiagnostics,
  } = options;
  const store =
    options.store ??
    createMemoryArtifactStore({
      files: files.map((file) => ({
        path: file.path,
        content: file.content,
        ...(projectId ? { projectId: projectId } : {}),
      })),
    });
  const project: ArtifactProjectDeclaration<string, any, any> = configuredProject
    ? withSchemaIdeProjectViews(configuredProject)
    : isProjectSchema(schema)
      ? createArtifactProjectFromProjectSchema(schema, { name: projectId ?? "schema-ide" })
      : SchemaIdeArtifactProject;
  const runtimeFiles = collectFiles(store);
  const runtimeValidation = runtimeFiles.pipe(
    Effect.map((currentFiles) => {
      const validation = (
        schema
          ? validateSchemaIdeValue({
              schema,
              files: currentFiles,
              activeFile,
              activeFormat,
            })
          : validateArtifactProjectValue({
              project,
              files: currentFiles,
              activeFormat,
            })
      ) as ValidationResult<A>;
      return appendProjectDiagnostics(
        validation,
        currentFiles,
        activeFile,
        activeFormat,
        projectDiagnostics,
      );
    }),
  );
  const runtimeRelationInputValidation: Effect.Effect<
    ValidationResult<any>,
    SchemaIdeArtifactError
  > = relationInputSchema && relationInputSchema === schema
    ? runtimeValidation
    : relationInputSchema
      ? runtimeFiles.pipe(
          Effect.map((currentFiles) =>
            validateSchemaIdeValue({
              schema: relationInputSchema,
              files: currentFiles,
              activeFile,
              activeFormat,
            }),
          ),
        )
      : (runtimeValidation as Effect.Effect<ValidationResult<any>, SchemaIdeArtifactError>);
  const runtimeReflection = Effect.gen(function* () {
    const currentFiles = yield* runtimeFiles;
    if (schema) {
      const validation = appendProjectDiagnostics(
        validateSchemaIdeValue({
          schema,
          files: currentFiles,
          activeFile,
          activeFormat,
        }),
        currentFiles,
        activeFile,
        activeFormat,
        projectDiagnostics,
      );
      return createReflection({
        schema,
        files: currentFiles,
        activeFile,
        activeFormat,
        validation,
      });
    }

    const validation = appendProjectDiagnostics(
      validateArtifactProjectValue({
        project,
        files: currentFiles,
        activeFormat,
      }) as ValidationResult<A>,
      currentFiles,
      activeFile,
      activeFormat,
      projectDiagnostics,
    );
    return createArtifactProjectReflection({
      project,
      files: currentFiles,
      activeFile,
      activeFormat,
      validation,
    });
  });
  const runtimeRelationGraph = runtimeRelationInputValidation.pipe(
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
  const runtimeRelationDiagnostics = runtimeRelationInputValidation.pipe(
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
  const runtimeEntityIndex = runtimeRelationGraph.pipe(Effect.map(buildEntityIndex));
  const runtimeDefinitionLocations = runtimeRelationGraph.pipe(
    Effect.map(relationDefinitionLocations),
  );
  const runtimeReferences = runtimeRelationGraph.pipe(Effect.map(relationReferences));
  const runtimeReferenceDiagnostics = runtimeRelationDiagnostics.pipe(
    Effect.map(relationReferenceDiagnostics),
  );
  const runtimePatchSuggestions = runtimeRelationDiagnostics.pipe(
    Effect.map(relationPatchSuggestions),
  );
  const preview = (
    previewFiles: readonly SourceFile[],
    previewActiveFile: string | null | undefined = activeFile,
  ): Effect.Effect<SchemaIdeReflection, SchemaIdeArtifactError> =>
    createSchemaIdeArtifactRuntime({
      files: previewFiles,
      activeFile: previewActiveFile ?? null,
      activeFormat,
      ...(projectId ? { projectId: projectId } : {}),
      project,
      ...(schema ? { schema } : {}),
      ...(relationSchema ? { relationSchema } : {}),
      ...(relationInputSchema && relationInputSchema !== schema ? { relationInputSchema } : {}),
      relationValue,
      ...(projectDiagnostics ? { projectDiagnostics } : {}),
    }).reflection;

  // Hash a ref's content to key the `contentHash` cache. Only single-file
  // (ProjectFile) refs are hashable cheaply; project-wide views resolve to
  // null so they fall through to no caching rather than re-reading every file.
  const resolveContentHash: ArtifactContentHashResolver = (ref) =>
    isProjectFileRef(ref)
      ? store.read(toStoredProjectFileRef(ref)).pipe(
          Effect.map((content) => hashArtifactContent(content)),
          Effect.catch(() => Effect.succeed(null)),
        )
      : Effect.succeed(null);

  const registry = ArtifactRegistry.make(project.api)
    .addHandler(
      ArtifactHandler.make(SchemaIdeProjectFileArtifact.view("sourceText"), ({ ref }) =>
        readProjectFileText(store, ref),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdeProjectFileArtifact.view("parsedValue"), ({ ref }) =>
        Effect.gen(function* () {
          const sourceText = yield* readProjectFileText(store, ref);
          return yield* parseProjectFile(sourceText, ref);
        }),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdeProjectFileArtifact.view("jsonSchema"), ({ ref }) =>
        fileJsonSchema(runtimeReflection, ref),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdeProjectFileArtifact.view("diagnostics"), ({ ref }) =>
        fileDiagnostics(runtimeValidation, ref),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdeProjectFileArtifact.view("relationGraph"), ({ ref }) =>
        fileRelationGraph(store, project, ref),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdeProjectFileArtifact.view("entityIndex"), ({ ref }) =>
        fileRelationGraph(store, project, ref).pipe(Effect.map(buildEntityIndex)),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdeProjectFileArtifact.view("definitionLocations"), ({ ref }) =>
        fileRelationGraph(store, project, ref).pipe(Effect.map(relationDefinitionLocations)),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdeProjectFileArtifact.view("references"), ({ ref }) =>
        fileRelationGraph(store, project, ref).pipe(Effect.map(relationReferences)),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdeProjectFileArtifact.view("relationDiagnostics"), ({ ref }) =>
        fileRelationDiagnostics(store, project, ref),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdeProjectFileArtifact.view("referenceDiagnostics"), ({ ref }) =>
        fileRelationDiagnostics(store, project, ref).pipe(Effect.map(relationReferenceDiagnostics)),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdeProjectFileArtifact.view("patchSuggestions"), ({ ref }) =>
        fileRelationDiagnostics(store, project, ref).pipe(Effect.map(relationPatchSuggestions)),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdePdfArtifact.view("inspect"), ({ ref }) =>
        analyzeFileArtifact(store, ref, inspectPdf),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdePdfArtifact.view("extractText"), ({ ref }) =>
        analyzeFileArtifact(store, ref, extractPdfText),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdeImageArtifact.view("inspect"), ({ ref }) =>
        analyzeFileArtifact(store, ref, (content, path) =>
          Promise.resolve(inspectImage(content, path)),
        ),
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
    .addHandler(ArtifactHandler.make(project.view("entityIndex"), () => runtimeEntityIndex))
    .addHandler(
      ArtifactHandler.make(project.view("definitionLocations"), () => runtimeDefinitionLocations),
    )
    .addHandler(ArtifactHandler.make(project.view("references"), () => runtimeReferences))
    .addHandler(
      ArtifactHandler.make(project.view("relationDiagnostics"), () => runtimeRelationDiagnostics),
    )
    .addHandler(
      ArtifactHandler.make(project.view("referenceDiagnostics"), () => runtimeReferenceDiagnostics),
    )
    .addHandler(
      ArtifactHandler.make(project.view("patchSuggestions"), () => runtimePatchSuggestions),
    )
    .withCache({ cache: options.cache ?? createMemoryArtifactCache(), resolveContentHash });

  const view: SchemaIdeArtifactRuntime["view"] = (ref, viewName, input, options) => {
    if (viewName === "decodedValue" && isProjectFileRef(ref)) {
      const route = project.route(ref).find((candidate) => candidate.schema);
      if (route?.schema) return fileDecodedValue(store, route.schema, ref);
    }

    return registry.view(ref, viewName, input, options);
  };

  return {
    project,
    store,
    registry,
    capabilities: project.capabilities.bind(project),
    view,
    files: runtimeFiles,
    validation: runtimeValidation as Effect.Effect<ValidationResult<A>, SchemaIdeArtifactError>,
    reflection: runtimeReflection,
    relationGraph: runtimeRelationGraph,
    entityIndex: runtimeEntityIndex,
    definitionLocations: runtimeDefinitionLocations,
    references: runtimeReferences,
    relationDiagnostics: runtimeRelationDiagnostics,
    referenceDiagnostics: runtimeReferenceDiagnostics,
    patchSuggestions: runtimePatchSuggestions,
    preview,
  };
}

export function validateSchemaIdeArtifacts<A>(
  options: ValidateSchemaIdeArtifactsOptions<A>,
): Effect.Effect<SchemaIdeReflection, SchemaIdeArtifactError> {
  return createSchemaIdeArtifactRuntime(options).reflection;
}

export const Artifacts = {
  runtime: createSchemaIdeArtifactRuntime,
  validate: validateSchemaIdeArtifacts,
} as const;

function appendProjectDiagnostics<A>(
  validation: ValidationResult<A>,
  files: readonly SourceFile[],
  activeFile: string | null,
  activeFormat: SchemaIdeDocumentFormat,
  projectDiagnostics: CreateSchemaIdeArtifactRuntimeOptions<A>["projectDiagnostics"] | undefined,
): ValidationResult<A> {
  // Skip project-level validators when schema validation already produced an
  // error. A workspace decode returns a *partial* value (files that failed to
  // decode are simply absent), so running cross-cutting validators here would
  // surface cascading false positives — e.g. a relation reporting a missing
  // target only because that target's file currently has a syntax error. We
  // suppress that noise and let the user fix the schema error first. A null
  // value likewise means there is nothing to validate against.
  if (
    !projectDiagnostics ||
    validation.value === null ||
    validation.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  ) {
    return validation;
  }

  const diagnostics = [
    ...validation.diagnostics,
    ...projectDiagnostics(validation.value, { files, activeFile, activeFormat }),
  ];
  return {
    value: diagnostics.some((diagnostic) => diagnostic.severity === "error")
      ? null
      : validation.value,
    diagnostics,
    summary: summarizeDiagnostics(diagnostics),
    routeMatches: validation.routeMatches,
  };
}

function createArtifactProjectReflection({
  project,
  files,
  activeFile,
  activeFormat,
  validation,
}: {
  readonly project: ArtifactProjectDeclaration<string, any, any>;
  readonly files: readonly SourceFile[];
  readonly activeFile: string | null;
  readonly activeFormat: SchemaIdeDocumentFormat;
  readonly validation: ValidationResult<unknown>;
}): SchemaIdeReflection {
  const schemas: readonly ReflectedSchema[] = project.routes.flatMap((route: ArtifactFileRoute) =>
    route.schema
      ? [
          withWorkspaceRouteAttributes(
            reflectEffectSchema({
              id: routeSchemaId(route),
              schema: route.schema as AnySchema,
              match: route.pattern,
              description: routeDescription(route),
            }),
            routeReflectionAttributes(route),
          ),
        ]
      : [],
  );
  const activeRoute = activeFile
    ? validation.routeMatches.find((route) => route.path === activeFile)
    : null;
  const activeSchema = activeRoute?.schemaId
    ? schemas.find((candidate) => candidate.id === activeRoute.schemaId)
    : schemas[0];

  return {
    mode: "workspace",
    activeFile,
    activeFormat,
    files,
    schemas,
    activeJsonSchema: activeSchema?.jsonSchema ?? null,
    decodedValue: validation.value,
    diagnostics: validation.diagnostics,
    validationSummary: validation.summary,
    routeMatches: validation.routeMatches,
  };
}

function collectFiles(
  store: ArtifactStore,
): Effect.Effect<readonly SourceFile[], SchemaIdeArtifactError> {
  return Effect.gen(function* () {
    const refs = yield* store.list.pipe(Effect.mapError(toArtifactError));
    const files: SourceFile[] = [];

    for (const ref of refs) {
      if (!isProjectFileRef(ref)) continue;
      const content = yield* store.read(ref).pipe(Effect.mapError(toArtifactError));
      files.push({ path: ref.path, content: contentToText(content) });
    }

    return files.sort((left, right) => left.path.localeCompare(right.path));
  });
}

function readProjectFileText(
  store: ArtifactStore,
  ref: ArtifactRefDefinition,
): Effect.Effect<string, SchemaIdeArtifactError> {
  if (!isProjectFileRef(ref)) {
    return Effect.fail({ message: `Expected ProjectFile ref, received ${ref._tag}` });
  }

  return store
    .read(toStoredProjectFileRef(ref))
    .pipe(Effect.map(contentToText), Effect.mapError(toArtifactError));
}

/**
 * Runs an async analyzer (real PDF parsing/text extraction, image header
 * inspection, …) over a stored file as an artifact view. The heavy lifting
 * lives in `./pdf` / `./image`; this just bridges the store read and Promise
 * into the Effect handler contract — the same path serves every binary type.
 */
function analyzeFileArtifact<A>(
  store: ArtifactStore,
  ref: ArtifactRefDefinition,
  analyze: (content: string, path: string) => Promise<A>,
): Effect.Effect<A, SchemaIdeArtifactError> {
  if (!isProjectFileRef(ref)) {
    return Effect.fail({ message: `Expected ProjectFile ref, received ${ref._tag}` });
  }

  return store.read(toStoredProjectFileRef(ref)).pipe(
    Effect.mapError(toArtifactError),
    Effect.flatMap((content) =>
      Effect.tryPromise({
        try: () => analyze(contentToText(content), ref.path),
        catch: toArtifactError,
      }),
    ),
  );
}

function parseProjectFile(
  sourceText: string,
  ref: ArtifactRefDefinition,
): Effect.Effect<unknown, SchemaIdeArtifactError> {
  if (!isProjectFileRef(ref)) {
    return Effect.fail({ message: `Expected ProjectFile ref, received ${ref._tag}` });
  }

  const parsed = parseDocument(sourceText, formatForPath(ref.path), ref.path);
  return parsed.success
    ? Effect.succeed(parsed.value)
    : Effect.fail({ message: parsed.diagnostic.message });
}

function fileDecodedValue(
  store: ArtifactStore,
  schema: Schema.Schema<unknown>,
  ref: ArtifactRefDefinition,
): Effect.Effect<unknown, SchemaIdeArtifactError> {
  return Effect.gen(function* () {
    const sourceText = yield* readProjectFileText(store, ref);
    const parsed = yield* parseProjectFile(sourceText, ref);
    const decoded = Schema.decodeUnknownResult(schema as never)(parsed) as unknown as Result.Result<
      unknown,
      SchemaIssue.Issue
    >;

    if (Result.isSuccess(decoded)) return decoded.success;

    return yield* Effect.fail({
      message: SchemaIssue.makeFormatterDefault()(decoded.failure),
    });
  });
}

function fileJsonSchema(
  reflection: Effect.Effect<SchemaIdeReflection, SchemaIdeArtifactError>,
  ref: ArtifactRefDefinition,
): Effect.Effect<unknown | null, SchemaIdeArtifactError> {
  if (!isProjectFileRef(ref)) {
    return Effect.fail({ message: `Expected ProjectFile ref, received ${ref._tag}` });
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
  if (!isProjectFileRef(ref)) {
    return Effect.fail({ message: `Expected ProjectFile ref, received ${ref._tag}` });
  }

  return validation.pipe(
    Effect.map((value) =>
      value.diagnostics.filter(
        (diagnostic) => diagnostic.path === ref.path || diagnostic.path === null,
      ),
    ),
  );
}

function fileRelationGraph(
  store: ArtifactStore,
  project: ArtifactProjectDeclaration<string, any, any>,
  ref: ArtifactRefDefinition,
): Effect.Effect<RelationGraph, SchemaIdeArtifactError> {
  const route = fileSchemaRoute(project, ref);
  if (!route?.schema) return Effect.succeed({ definitions: [], references: [] });

  return fileDecodedValue(store, route.schema, ref).pipe(
    Effect.flatMap((value) =>
      Effect.try({
        try: () => buildRelationGraph(route.schema as AnySchema, value),
        catch: toArtifactError,
      }),
    ),
  );
}

function fileRelationDiagnostics(
  store: ArtifactStore,
  project: ArtifactProjectDeclaration<string, any, any>,
  ref: ArtifactRefDefinition,
): Effect.Effect<readonly RelationDiagnostic[], SchemaIdeArtifactError> {
  const route = fileSchemaRoute(project, ref);
  if (!route?.schema) return Effect.succeed([]);

  return fileDecodedValue(store, route.schema, ref).pipe(
    Effect.flatMap((value) =>
      Effect.try({
        try: () => validateRelations(route.schema as AnySchema, value),
        catch: toArtifactError,
      }),
    ),
  );
}

function fileSchemaRoute(
  project: ArtifactProjectDeclaration<string, any, any>,
  ref: ArtifactRefDefinition,
) {
  if (!isProjectFileRef(ref)) return null;
  return project.route(ref).find((candidate) => candidate.schema) ?? null;
}

function isProjectFileRef(
  ref: ArtifactRefDefinition,
): ref is Extract<ArtifactRefDefinition, { readonly _tag: "ProjectFile" }> {
  return ref._tag === "ProjectFile";
}

function toStoredProjectFileRef(
  ref: Extract<ArtifactRefDefinition, { readonly _tag: "ProjectFile" }>,
): Extract<ArtifactRefDefinition, { readonly _tag: "ProjectFile" }> {
  return ref;
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
export type SchemaIdeProjectFileArtifact = typeof SchemaIdeProjectFileArtifact;

function attributeString(
  attributes: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = attributes[key];
  return typeof value === "string" ? value : undefined;
}
