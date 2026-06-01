import { Effect, Result, Schema, SchemaIssue } from "effect";
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
  type ArtifactFileRoute,
  type ArtifactProjectDeclaration,
  type ArtifactRefDefinition,
  type ArtifactRegistryError,
  type ArtifactRegistryDeclaration,
  type ArtifactStore,
  type ArtifactViewOptions,
} from "@schema-ide/artifacts";
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
import { parseErrorToDiagnostics, summarizeDiagnostics } from "./diagnostics";
import {
  reflectEffectSchema,
  sourceSchemaFromReflection,
  withWorkspaceRouteAttributes,
  workspaceRouteAttributesFromReflection,
} from "./reflection";
import { createReflection, validateSchemaIdeValue, type SchemaIdeInputSchema } from "./validation";
import { Workspace, isWorkspaceSchema, type WorkspaceSchema } from "./workspace-schema";
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
  readonly workspaceId?: string | undefined;
  readonly store?: ArtifactStore | undefined;
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

export interface CreateArtifactProjectFromWorkspaceOptions {
  readonly name?: string | undefined;
}

export interface CreateWorkspaceFromArtifactProjectOptions {
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
          type: SchemaIdeWorkspaceFileArtifact as unknown as AnyArtifactType,
          schema: sourceSchema,
          id: reflected.id,
          metadata: routeMetadata,
        })
      : project.files(
          reflected.match,
          SchemaIdeWorkspaceFileArtifact as unknown as AnyArtifactType,
          {
            id: reflected.id,
            metadata: routeMetadata,
          },
        );
  }

  return project;
}

export function createWorkspaceFromArtifactProject(
  project: ArtifactProjectDeclaration<string, any, any>,
  options: CreateWorkspaceFromArtifactProjectOptions = {},
): WorkspaceSchema<Record<string, unknown>> {
  const fields: Record<string, unknown> = {};

  for (const route of project.routes) {
    if (!route.schema) continue;

    const attributes = route.metadata?.attributes ?? {};
    const fieldName = options.fieldName?.(route) ?? routeWorkspaceField(route);
    const optional = routeOptional(route);
    const annotations = options.annotations?.(route) ?? {};
    const identifier =
      annotations.identifier ??
      stringAttribute(attributes, "schemaId") ??
      stringAttribute(attributes, "identifier") ??
      route.id;
    const description = annotations.description ?? routeDescription(route);
    const indexBy = options.indexBy?.(route) ?? routeIndexBy(route);
    const mode = options.mode?.(route) ?? routeMode(route);

    let field =
      mode === "file"
        ? (Workspace.file(route.pattern, route.schema, { optional }) as any)
        : (Workspace.files(route.pattern, route.schema, { optional }) as any);
    field = field.pipe(Workspace.annotations({ identifier, description }));
    if (mode !== "file" && indexBy) {
      field = field.pipe(Workspace.indexBy(indexBy as never));
    } else if (mode === "values") {
      field = field.pipe(Workspace.values());
    }
    fields[fieldName] = field;
  }

  return Workspace.Struct(fields as never) as WorkspaceSchema<Record<string, unknown>>;
}

function createSchemaIdeArtifactProject(name: string) {
  return withSchemaIdeWorkspaceViews(ArtifactProject.make(name));
}

function withSchemaIdeWorkspaceViews(
  project: ArtifactProjectDeclaration<string, any, any>,
): ArtifactProjectDeclaration<string, any, any> {
  let next = project;
  if (!next.workspaceType.views["decodedWorkspace"]) {
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
  if (!next.workspaceType.views["diagnostics"]) {
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
  if (!next.workspaceType.views["validationSummary"]) {
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
  if (!next.workspaceType.views["routeMatches"]) {
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
  if (!next.workspaceType.views["reflection"]) {
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
  if (!next.workspaceType.views["relationGraph"]) {
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
  if (!next.workspaceType.views["entityIndex"]) {
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
  if (!next.workspaceType.views["definitionLocations"]) {
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
  if (!next.workspaceType.views["references"]) {
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
  if (!next.workspaceType.views["relationDiagnostics"]) {
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
  if (!next.workspaceType.views["referenceDiagnostics"]) {
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
  if (!next.workspaceType.views["patchSuggestions"]) {
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
    workspaceId,
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
        ...(workspaceId ? { workspaceId } : {}),
      })),
    });
  const project: ArtifactProjectDeclaration<string, any, any> = configuredProject
    ? withSchemaIdeWorkspaceViews(configuredProject)
    : isWorkspaceSchema(schema)
      ? createArtifactProjectFromWorkspace(schema, { name: workspaceId ?? "schema-ide" })
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
      ...(workspaceId ? { workspaceId } : {}),
      project,
      ...(schema ? { schema } : {}),
      ...(relationSchema ? { relationSchema } : {}),
      ...(relationInputSchema && relationInputSchema !== schema ? { relationInputSchema } : {}),
      relationValue,
      ...(projectDiagnostics ? { projectDiagnostics } : {}),
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
      ArtifactHandler.make(SchemaIdeWorkspaceFileArtifact.view("relationGraph"), ({ ref }) =>
        fileRelationGraph(store, project, ref),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdeWorkspaceFileArtifact.view("entityIndex"), ({ ref }) =>
        fileRelationGraph(store, project, ref).pipe(Effect.map(buildEntityIndex)),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdeWorkspaceFileArtifact.view("definitionLocations"), ({ ref }) =>
        fileRelationGraph(store, project, ref).pipe(Effect.map(relationDefinitionLocations)),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdeWorkspaceFileArtifact.view("references"), ({ ref }) =>
        fileRelationGraph(store, project, ref).pipe(Effect.map(relationReferences)),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdeWorkspaceFileArtifact.view("relationDiagnostics"), ({ ref }) =>
        fileRelationDiagnostics(store, project, ref),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdeWorkspaceFileArtifact.view("referenceDiagnostics"), ({ ref }) =>
        fileRelationDiagnostics(store, project, ref).pipe(Effect.map(relationReferenceDiagnostics)),
      ),
    )
    .addHandler(
      ArtifactHandler.make(SchemaIdeWorkspaceFileArtifact.view("patchSuggestions"), ({ ref }) =>
        fileRelationDiagnostics(store, project, ref).pipe(Effect.map(relationPatchSuggestions)),
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
    );

  const view: SchemaIdeArtifactRuntime["view"] = (ref, viewName, input, options) => {
    if (viewName === "decodedValue" && ref._tag === "WorkspaceFile") {
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

function validateArtifactProjectValue({
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

function artifactProjectRouteMatches(
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

function projectFileRoutes(
  project: ArtifactProjectDeclaration<string, any, any>,
  path: string,
): readonly ArtifactFileRoute[] {
  return project.route({ _tag: "WorkspaceFile", path });
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

function routeReflectionAttributes(route: ArtifactFileRoute) {
  return {
    workspaceField: routeWorkspaceField(route),
    ...(routeMode(route) === "file" ? { single: true } : {}),
    ...(routeMode(route) === "values" ? { values: true } : {}),
    ...(routeIndexBy(route) ? { indexBy: routeIndexBy(route) } : {}),
    ...(routeOptional(route) ? { optional: true } : {}),
  };
}

function routeSchemaId(route: ArtifactFileRoute): string {
  return stringAttribute(route.metadata?.attributes ?? {}, "schemaId") ?? route.id;
}

function routeWorkspaceField(route: ArtifactFileRoute): string {
  return (
    route.config?.workspaceField ??
    stringAttribute(route.metadata?.attributes ?? {}, "workspaceField") ??
    route.id
  );
}

function routeMode(route: ArtifactFileRoute): "file" | "files" | "values" {
  if (route.config?.mode) return route.config.mode;
  const attributes = route.metadata?.attributes ?? {};
  return attributes["single"] === true
    ? "file"
    : attributes["values"] === true
      ? "values"
      : "files";
}

function routeIndexBy(route: ArtifactFileRoute): string | undefined {
  return route.config?.indexBy ?? stringAttribute(route.metadata?.attributes ?? {}, "indexBy");
}

function routeDescription(route: ArtifactFileRoute): string | undefined {
  return (
    route.config?.description ?? stringAttribute(route.metadata?.attributes ?? {}, "description")
  );
}

function routeOptional(route: ArtifactFileRoute): boolean {
  return route.config?.optional ?? route.metadata?.attributes?.["optional"] === true;
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

function fileDecodedValue(
  store: ArtifactStore,
  schema: Schema.Schema<unknown>,
  ref: ArtifactRefDefinition,
): Effect.Effect<unknown, SchemaIdeArtifactError> {
  return Effect.gen(function* () {
    const sourceText = yield* readWorkspaceFileText(store, ref);
    const parsed = yield* parseWorkspaceFile(sourceText, ref);
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
  if (ref._tag !== "WorkspaceFile") return null;
  return project.route(ref).find((candidate) => candidate.schema) ?? null;
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === "object");
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

export type SchemaIdeArtifactProject = typeof SchemaIdeArtifactProject;
export type SchemaIdeWorkspaceFileArtifact = typeof SchemaIdeWorkspaceFileArtifact;
