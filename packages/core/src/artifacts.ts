import { Effect, Result, Schema, SchemaIssue } from "effect";
import {
  ArtifactHandler,
  ArtifactMatcher,
  ArtifactProject,
  ArtifactRegistry,
  ArtifactType,
  CachePolicy,
  Cost,
  classifyProjectPath,
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
} from "@schematics/artifacts";
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
} from "@schematics/algebra";
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
import {
  createReflection,
  validateSchematicsValue,
  type SchematicsInputSchema,
} from "./validation";
import { Project, isProjectSchema, type ProjectSchema } from "./project-schema";
import type { AnySchema } from "./types";
import type {
  ReflectedSchema,
  SchematicsDiagnostic,
  SchematicsDocumentFormat,
  SchematicsReflection,
  SourceFile,
  ValidationResult,
} from "./types";

const SchematicsArtifactErrorSchema = Schema.Struct({
  message: Schema.String,
});

const SchematicsValidationSummarySchema = Schema.Struct({
  valid: Schema.Boolean,
  errorCount: Schema.Number,
  warningCount: Schema.Number,
  infoCount: Schema.Number,
});

const SchematicsRelationGraphSchema = Schema.Struct({
  definitions: Schema.Array(Schema.Unknown),
  references: Schema.Array(Schema.Unknown),
});

const SchematicsRelationArraySchema = Schema.Array(Schema.Unknown);
const redactedSecretSourceText = "<redacted secret>";

export interface SchematicsArtifactError {
  readonly message: string;
}

export type {
  SchematicsPdfField,
  SchematicsPdfFieldType,
  SchematicsPdfInspection,
  SchematicsPdfPageGeometry,
  SchematicsPdfPageText,
  SchematicsPdfTextExtraction,
} from "./pdf";
export type { SchematicsImageFormat, SchematicsImageInspection } from "./image";

export interface SchematicsArtifactRuntime<A = unknown> {
  readonly project: ArtifactProjectDeclaration<string, any, any>;
  readonly store: ArtifactStore;
  readonly registry: ArtifactRegistryDeclaration<any>;
  readonly capabilities: ArtifactProjectDeclaration<string, any, any>["capabilities"];
  readonly view: (
    ref: ArtifactRefDefinition,
    viewName: string,
    input?: unknown,
    options?: ArtifactViewOptions,
  ) => Effect.Effect<unknown, ArtifactRegistryError | SchematicsArtifactError>;
  readonly files: Effect.Effect<readonly SourceFile[], SchematicsArtifactError>;
  readonly validation: Effect.Effect<ValidationResult<A>, SchematicsArtifactError>;
  readonly reflection: Effect.Effect<SchematicsReflection, SchematicsArtifactError>;
  readonly relationGraph: Effect.Effect<RelationGraph, SchematicsArtifactError>;
  readonly entityIndex: Effect.Effect<RelationEntityIndex, SchematicsArtifactError>;
  readonly definitionLocations: Effect.Effect<
    readonly RelationDefinition[],
    SchematicsArtifactError
  >;
  readonly references: Effect.Effect<readonly RelationReference[], SchematicsArtifactError>;
  readonly relationDiagnostics: Effect.Effect<
    readonly RelationDiagnostic[],
    SchematicsArtifactError
  >;
  readonly referenceDiagnostics: Effect.Effect<
    readonly RelationDiagnostic[],
    SchematicsArtifactError
  >;
  readonly patchSuggestions: Effect.Effect<
    readonly RelationPatchSuggestion[],
    SchematicsArtifactError
  >;
  readonly preview: (
    files: readonly SourceFile[],
    activeFile?: string | null | undefined,
  ) => Effect.Effect<SchematicsReflection, SchematicsArtifactError>;
}

export interface CreateSchematicsArtifactRuntimeOptions<A = unknown> {
  readonly schema?: SchematicsInputSchema<A> | undefined;
  readonly files: readonly SourceFile[];
  readonly activeFile: string | null;
  readonly activeFormat: SchematicsDocumentFormat;
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
  readonly relationInputSchema?: SchematicsInputSchema<any> | undefined;
  readonly relationSchema?: AnySchema | undefined;
  readonly relationValue?: ((value: any) => unknown) | undefined;
  readonly projectDiagnostics?:
    | ((
        value: A,
        context: {
          readonly files: readonly SourceFile[];
          readonly activeFile: string | null;
          readonly activeFormat: SchematicsDocumentFormat;
        },
      ) => readonly SchematicsDiagnostic[])
    | undefined;
}

export type ValidateSchematicsArtifactsOptions<A = unknown> =
  CreateSchematicsArtifactRuntimeOptions<A>;

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

export const SchematicsProjectFileArtifact = ArtifactType.make("schematics.project-file")
  .match(ArtifactMatcher.tag("ProjectFile"))
  .view("sourceText", {
    output: Schema.String,
    error: SchematicsArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.ref,
      mediaType: "text/plain",
    },
  })
  .view("parsedValue", {
    output: Schema.Unknown,
    error: SchematicsArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  })
  .view("jsonSchema", {
    output: Schema.NullOr(Schema.Unknown),
    error: SchematicsArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/schema+json",
    },
  })
  .view("diagnostics", {
    output: Schema.Array(Schema.Unknown),
    error: SchematicsArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  })
  .view("relationGraph", {
    output: SchematicsRelationGraphSchema,
    error: SchematicsArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  })
  .view("entityIndex", {
    output: SchematicsRelationArraySchema,
    error: SchematicsArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  })
  .view("definitionLocations", {
    output: SchematicsRelationArraySchema,
    error: SchematicsArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  })
  .view("references", {
    output: SchematicsRelationArraySchema,
    error: SchematicsArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  })
  .view("relationDiagnostics", {
    output: SchematicsRelationArraySchema,
    error: SchematicsArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  })
  .view("referenceDiagnostics", {
    output: SchematicsRelationArraySchema,
    error: SchematicsArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  })
  .view("patchSuggestions", {
    output: SchematicsRelationArraySchema,
    error: SchematicsArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  });

const SchematicsPdfInspectionSchema = Schema.Struct({
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

const SchematicsPdfTextExtractionSchema = Schema.Struct({
  kind: Schema.Literal("pdf-text"),
  path: Schema.String,
  pageCount: Schema.Number,
  pages: Schema.Array(Schema.Struct({ page: Schema.Number, text: Schema.String })),
  text: Schema.String,
  extractable: Schema.Boolean,
});

export const SchematicsPdfArtifact = ArtifactType.make("schematics.pdf")
  .match(ArtifactMatcher.extension("pdf"))
  .match(ArtifactMatcher.mime("application/pdf"))
  .view("inspect", {
    output: SchematicsPdfInspectionSchema,
    error: SchematicsArtifactErrorSchema,
    annotations: {
      // Real document parsing (pdf-lib) — heavier than a byte heuristic, so the
      // content-hash cache earns its keep here.
      cost: Cost.medium,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  })
  .view("extractText", {
    output: SchematicsPdfTextExtractionSchema,
    error: SchematicsArtifactErrorSchema,
    annotations: {
      cost: Cost.high,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  });

const SchematicsImageInspectionSchema = Schema.Struct({
  kind: Schema.Literal("image"),
  path: Schema.String,
  format: Schema.Literals(["png", "jpeg", "gif", "webp", "bmp", "svg", "unknown"]),
  width: Schema.NullOr(Schema.Number),
  height: Schema.NullOr(Schema.Number),
  byteLength: Schema.Number,
});

export const SchematicsImageArtifact = ArtifactType.make("schematics.image")
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
    output: SchematicsImageInspectionSchema,
    error: SchematicsArtifactErrorSchema,
    annotations: {
      cost: Cost.low,
      cache: CachePolicy.contentHash,
      mediaType: "application/json",
    },
  });

export const SchematicsArtifactProject = createSchematicsArtifactProject("schematics").files(
  "**",
  SchematicsProjectFileArtifact as unknown as AnyArtifactType,
  { id: "files" },
);

export function createArtifactProjectFromProjectSchema(
  schema: ProjectSchema<unknown>,
  { name = "schematics" }: CreateArtifactProjectFromProjectSchemaOptions = {},
): ArtifactProjectDeclaration<string, any, any> {
  let project = createSchematicsArtifactProject(name) as ArtifactProjectDeclaration<
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
          type: SchematicsProjectFileArtifact as unknown as AnyArtifactType,
          schema: sourceSchema,
          id: reflected.id,
          metadata: routeMetadata,
        })
      : project.files(
          reflected.match,
          SchematicsProjectFileArtifact as unknown as AnyArtifactType,
          {
            id: reflected.id,
            metadata: routeMetadata,
          },
        );
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

function createSchematicsArtifactProject(name: string) {
  return withSchematicsProjectViews(ArtifactProject.make(name));
}

function withSchematicsProjectViews(
  project: ArtifactProjectDeclaration<string, any, any>,
): ArtifactProjectDeclaration<string, any, any> {
  let next = project;
  if (!next.projectType.views["decodedWorkspace"]) {
    next = next.view("decodedWorkspace", {
      output: Schema.NullOr(Schema.Unknown),
      error: SchematicsArtifactErrorSchema,
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
      error: SchematicsArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    }) as ArtifactProjectDeclaration<string, any, any>;
  }
  if (!next.projectType.views["validationSummary"]) {
    next = next.view("validationSummary", {
      output: SchematicsValidationSummarySchema,
      error: SchematicsArtifactErrorSchema,
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
      error: SchematicsArtifactErrorSchema,
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
      error: SchematicsArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    }) as ArtifactProjectDeclaration<string, any, any>;
  }
  if (!next.projectType.views["relationGraph"]) {
    next = next.view("relationGraph", {
      output: SchematicsRelationGraphSchema,
      error: SchematicsArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    }) as ArtifactProjectDeclaration<string, any, any>;
  }
  if (!next.projectType.views["entityIndex"]) {
    next = next.view("entityIndex", {
      output: SchematicsRelationArraySchema,
      error: SchematicsArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    }) as ArtifactProjectDeclaration<string, any, any>;
  }
  if (!next.projectType.views["definitionLocations"]) {
    next = next.view("definitionLocations", {
      output: SchematicsRelationArraySchema,
      error: SchematicsArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    }) as ArtifactProjectDeclaration<string, any, any>;
  }
  if (!next.projectType.views["references"]) {
    next = next.view("references", {
      output: SchematicsRelationArraySchema,
      error: SchematicsArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    }) as ArtifactProjectDeclaration<string, any, any>;
  }
  if (!next.projectType.views["relationDiagnostics"]) {
    next = next.view("relationDiagnostics", {
      output: SchematicsRelationArraySchema,
      error: SchematicsArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    }) as ArtifactProjectDeclaration<string, any, any>;
  }
  if (!next.projectType.views["referenceDiagnostics"]) {
    next = next.view("referenceDiagnostics", {
      output: SchematicsRelationArraySchema,
      error: SchematicsArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    }) as ArtifactProjectDeclaration<string, any, any>;
  }
  if (!next.projectType.views["patchSuggestions"]) {
    next = next.view("patchSuggestions", {
      output: SchematicsRelationArraySchema,
      error: SchematicsArtifactErrorSchema,
      annotations: {
        cost: Cost.low,
        cache: CachePolicy.contentHash,
        mediaType: "application/json",
      },
    }) as ArtifactProjectDeclaration<string, any, any>;
  }
  return next;
}

export function createSchematicsArtifactRuntime<A>(
  options: CreateSchematicsArtifactRuntimeOptions<A>,
): SchematicsArtifactRuntime<A> {
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
    ? withSchematicsProjectViews(configuredProject)
    : isProjectSchema(schema)
      ? createArtifactProjectFromProjectSchema(schema, { name: projectId ?? "schematics" })
      : SchematicsArtifactProject;
  const runtimeFiles = collectFiles(store);
  const runtimeValidation = runtimeFiles.pipe(
    Effect.map((currentFiles) => {
      const validationFiles = projectValidationFiles(project, currentFiles);
      const validation = (
        schema
          ? validateSchematicsValue({
              schema,
              files: validationFiles,
              activeFile,
              activeFormat,
            })
          : validateArtifactProjectValue({
              project,
              files: validationFiles,
              activeFormat,
            })
      ) as ValidationResult<A>;
      return withClassifiedRouteMatches(
        project,
        appendProjectDiagnostics(
          validation,
          validationFiles,
          activeFile,
          activeFormat,
          projectDiagnostics,
        ),
        currentFiles,
        activeFormat,
      );
    }),
  );
  const runtimeRelationInputValidation: Effect.Effect<
    ValidationResult<any>,
    SchematicsArtifactError
  > = relationInputSchema && relationInputSchema === schema
    ? runtimeValidation
    : relationInputSchema
      ? runtimeFiles.pipe(
          Effect.map((currentFiles) =>
            validateSchematicsValue({
              schema: relationInputSchema,
              files: projectValidationFiles(project, currentFiles),
              activeFile,
              activeFormat,
            }),
          ),
        )
      : (runtimeValidation as Effect.Effect<ValidationResult<any>, SchematicsArtifactError>);
  const runtimeReflection = Effect.gen(function* () {
    const currentFiles = yield* runtimeFiles;
    const validationFiles = projectValidationFiles(project, currentFiles);
    if (schema) {
      const validation = withClassifiedRouteMatches(
        project,
        appendProjectDiagnostics(
          validateSchematicsValue({
            schema,
            files: validationFiles,
            activeFile,
            activeFormat,
          }),
          validationFiles,
          activeFile,
          activeFormat,
          projectDiagnostics,
        ),
        currentFiles,
        activeFormat,
      );
      return createReflection({
        schema,
        files: redactSecretFiles(project, currentFiles),
        activeFile,
        activeFormat,
        validation,
      });
    }

    const validation = appendProjectDiagnostics(
      validateArtifactProjectValue({
        project,
        files: validationFiles,
        activeFormat,
      }) as ValidationResult<A>,
      validationFiles,
      activeFile,
      activeFormat,
      projectDiagnostics,
    );
    return createArtifactProjectReflection({
      project,
      files: redactSecretFiles(project, currentFiles),
      activeFile,
      activeFormat,
      validation: withClassifiedRouteMatches(project, validation, currentFiles, activeFormat),
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
  ): Effect.Effect<SchematicsReflection, SchematicsArtifactError> =>
    createSchematicsArtifactRuntime({
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
      ArtifactHandler.make(SchematicsProjectFileArtifact.view("sourceText"), ({ ref }) =>
        isSecretProjectFile(project, ref)
          ? Effect.succeed(redactedSecretSourceText)
          : readProjectFileText(store, ref),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchematicsProjectFileArtifact.view("parsedValue"), ({ ref }) =>
        isSecretProjectFile(project, ref)
          ? Effect.succeed(null)
          : Effect.gen(function* () {
              const sourceText = yield* readProjectFileText(store, ref);
              return yield* parseProjectFile(sourceText, ref);
            }),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchematicsProjectFileArtifact.view("jsonSchema"), ({ ref }) =>
        fileJsonSchema(project, runtimeReflection, ref),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchematicsProjectFileArtifact.view("diagnostics"), ({ ref }) =>
        fileDiagnostics(project, runtimeValidation, ref),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchematicsProjectFileArtifact.view("relationGraph"), ({ ref }) =>
        fileRelationGraph(store, project, ref),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchematicsProjectFileArtifact.view("entityIndex"), ({ ref }) =>
        fileRelationGraph(store, project, ref).pipe(Effect.map(buildEntityIndex)),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchematicsProjectFileArtifact.view("definitionLocations"), ({ ref }) =>
        fileRelationGraph(store, project, ref).pipe(Effect.map(relationDefinitionLocations)),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchematicsProjectFileArtifact.view("references"), ({ ref }) =>
        fileRelationGraph(store, project, ref).pipe(Effect.map(relationReferences)),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchematicsProjectFileArtifact.view("relationDiagnostics"), ({ ref }) =>
        fileRelationDiagnostics(store, project, ref),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchematicsProjectFileArtifact.view("referenceDiagnostics"), ({ ref }) =>
        fileRelationDiagnostics(store, project, ref).pipe(Effect.map(relationReferenceDiagnostics)),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchematicsProjectFileArtifact.view("patchSuggestions"), ({ ref }) =>
        fileRelationDiagnostics(store, project, ref).pipe(Effect.map(relationPatchSuggestions)),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchematicsPdfArtifact.view("inspect"), ({ ref }) =>
        analyzeFileArtifact(store, ref, inspectPdf),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchematicsPdfArtifact.view("extractText"), ({ ref }) =>
        analyzeFileArtifact(store, ref, extractPdfText),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchematicsImageArtifact.view("inspect"), ({ ref }) =>
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

  const view: SchematicsArtifactRuntime["view"] = (ref, viewName, input, options) => {
    if (viewName === "decodedValue" && isProjectFileRef(ref)) {
      const route = fileSchemaRoute(project, ref);
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
    validation: runtimeValidation as Effect.Effect<ValidationResult<A>, SchematicsArtifactError>,
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

export function validateSchematicsArtifacts<A>(
  options: ValidateSchematicsArtifactsOptions<A>,
): Effect.Effect<SchematicsReflection, SchematicsArtifactError> {
  return createSchematicsArtifactRuntime(options).reflection;
}

export const Artifacts = {
  runtime: createSchematicsArtifactRuntime,
  validate: validateSchematicsArtifacts,
} as const;

function appendProjectDiagnostics<A>(
  validation: ValidationResult<A>,
  files: readonly SourceFile[],
  activeFile: string | null,
  activeFormat: SchematicsDocumentFormat,
  projectDiagnostics: CreateSchematicsArtifactRuntimeOptions<A>["projectDiagnostics"] | undefined,
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

function projectValidationFiles(
  project: ArtifactProjectDeclaration<string, any, any>,
  files: readonly SourceFile[],
): readonly SourceFile[] {
  return files.filter((file) => classifyProjectPath(project, file.path) === "config");
}

function withClassifiedRouteMatches<A>(
  project: ArtifactProjectDeclaration<string, any, any>,
  validation: ValidationResult<A>,
  files: readonly SourceFile[],
  activeFormat: SchematicsDocumentFormat,
): ValidationResult<A> {
  const existing = new Set(validation.routeMatches.map((match) => match.path));
  const classified = files
    .filter((file) => !existing.has(file.path))
    .flatMap((file) => {
      const fileClass = classifyProjectPath(project, file.path);
      return fileClass === "config"
        ? []
        : [
            {
              path: file.path,
              schemaId: null,
              format: formatForPath(file.path, activeFormat),
              fileClass,
            },
          ];
    });
  if (!classified.length) return validation;
  return {
    ...validation,
    routeMatches: [...validation.routeMatches, ...classified].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
  };
}

function redactSecretFiles(
  project: ArtifactProjectDeclaration<string, any, any>,
  files: readonly SourceFile[],
): readonly SourceFile[] {
  return files.map((file) =>
    classifyProjectPath(project, file.path) === "secret"
      ? { ...file, content: redactedSecretSourceText }
      : file,
  );
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
  readonly activeFormat: SchematicsDocumentFormat;
  readonly validation: ValidationResult<unknown>;
}): SchematicsReflection {
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
): Effect.Effect<readonly SourceFile[], SchematicsArtifactError> {
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
): Effect.Effect<string, SchematicsArtifactError> {
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
): Effect.Effect<A, SchematicsArtifactError> {
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
): Effect.Effect<unknown, SchematicsArtifactError> {
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
): Effect.Effect<unknown, SchematicsArtifactError> {
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
  project: ArtifactProjectDeclaration<string, any, any>,
  reflection: Effect.Effect<SchematicsReflection, SchematicsArtifactError>,
  ref: ArtifactRefDefinition,
): Effect.Effect<unknown | null, SchematicsArtifactError> {
  if (!isProjectFileRef(ref)) {
    return Effect.fail({ message: `Expected ProjectFile ref, received ${ref._tag}` });
  }
  if (classifyProjectPath(project, ref.path) !== "config") return Effect.succeed(null);

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
  project: ArtifactProjectDeclaration<string, any, any>,
  validation: Effect.Effect<ValidationResult<unknown>, SchematicsArtifactError>,
  ref: ArtifactRefDefinition,
): Effect.Effect<readonly SchematicsDiagnostic[], SchematicsArtifactError> {
  if (!isProjectFileRef(ref)) {
    return Effect.fail({ message: `Expected ProjectFile ref, received ${ref._tag}` });
  }
  if (classifyProjectPath(project, ref.path) !== "config") return Effect.succeed([]);

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
): Effect.Effect<RelationGraph, SchematicsArtifactError> {
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
): Effect.Effect<readonly RelationDiagnostic[], SchematicsArtifactError> {
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
  if (classifyProjectPath(project, ref.path) !== "config") return null;
  return project.route(ref).find((candidate) => candidate.schema) ?? null;
}

function isSecretProjectFile(
  project: ArtifactProjectDeclaration<string, any, any>,
  ref: ArtifactRefDefinition,
): ref is Extract<ArtifactRefDefinition, { readonly _tag: "ProjectFile" }> {
  return isProjectFileRef(ref) && classifyProjectPath(project, ref.path) === "secret";
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

function toArtifactError(error: unknown): SchematicsArtifactError {
  if (typeof error === "object" && error !== null && "reason" in error) {
    return { message: `Artifact store ${String(error.reason)}` };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

function hasAst(value: unknown): value is AnySchema {
  return Boolean(value && typeof value === "object" && "ast" in value);
}

export type SchematicsArtifactProject = typeof SchematicsArtifactProject;
export type SchematicsProjectFileArtifact = typeof SchematicsProjectFileArtifact;

function attributeString(
  attributes: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = attributes[key];
  return typeof value === "string" ? value : undefined;
}
