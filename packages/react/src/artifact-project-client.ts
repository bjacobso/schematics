import {
  codecForPath,
  createSchemaIdeArtifactRuntime,
  isWorkspaceSchema,
  stringifyDocument,
  type SchemaIdeArtifactRuntime,
  type SchemaIdeDocumentFormat,
  type SchemaIdeInputSchema,
  type SourceFile,
  type WorkspaceRouteMap,
} from "@schema-ide/core";
import {
  SchemaIdeArtifactProjectError,
  SchemaIdeArtifactProjectRpcGroup,
  artifactChangeToProjectChange,
  artifactProjectRpcErrorToError,
  type SchemaIdeArtifactProjectService,
  type ArtifactProjectCapabilities,
  type ArtifactProjectChangeRequest,
  type ArtifactProjectEvent,
  type ArtifactProjectSnapshot,
  type SchemaIdeValidationSummaryDto,
} from "@schema-ide/protocol";
import {
  ArtifactRef,
  createVersionedArtifactStore,
  type ArtifactProjectDeclaration,
  type ArtifactRefDefinition,
  type ArtifactStoreChange,
  type ArtifactStoreEntry,
} from "@schema-ide/artifacts";
import { Effect, Queue, Stream } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

interface CreateArtifactRuntimeWorkspaceClientOptions {
  readonly title?: string | undefined;
  readonly projectId?: string | undefined;
  readonly readOnly?: boolean | undefined;
  readonly agentEnabled?: boolean | undefined;
}

export interface CreateSchemaIdeArtifactClientOptions<
  A = unknown,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
> extends CreateArtifactRuntimeWorkspaceClientOptions {
  readonly artifacts?: SchemaIdeArtifactRuntime<A> | undefined;
  readonly project?: ArtifactProjectDeclaration<string, any, any> | undefined;
  readonly schema?: SchemaIdeInputSchema<A, Routes> | undefined;
  readonly defaultFormat?: SchemaIdeDocumentFormat | undefined;
  readonly activeFile?: string | null | undefined;
  readonly initialFiles?: readonly SourceFile[] | undefined;
  readonly initialValue?: A | undefined;
  readonly value?: A | undefined;
}

export function createSchemaIdeArtifactClient<
  A,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
>({
  artifacts,
  project,
  schema,
  defaultFormat = "json",
  activeFile,
  initialFiles,
  initialValue,
  value,
  title,
  projectId = project?.name,
  readOnly,
  agentEnabled,
}: CreateSchemaIdeArtifactClientOptions<A, Routes>): SchemaIdeArtifactProjectService {
  if (artifacts) {
    return createArtifactRuntimeWorkspaceClient(artifacts, {
      title,
      projectId,
      readOnly,
      agentEnabled,
    });
  }

  if (!project && !schema) {
    throw new Error("createSchemaIdeArtifactClient requires artifacts, project, or schema.");
  }

  const shouldCreateDefaultDocument =
    !project &&
    !isWorkspaceSchema(schema) &&
    (initialValue !== undefined || value !== undefined || schema);
  const files = initialFiles?.length
    ? initialFiles
    : shouldCreateDefaultDocument
      ? [
          {
            path: `document.${defaultFormat === "yaml" ? "yaml" : "json"}`,
            content: stringifyDocument(value ?? initialValue ?? {}, defaultFormat),
          },
        ]
      : [];
  const selectedActiveFile =
    activeFile && files.some((file) => file.path === activeFile)
      ? activeFile
      : (files[0]?.path ?? null);
  const activeFormat = selectedActiveFile
    ? codecForPath(selectedActiveFile, defaultFormat).format
    : defaultFormat;
  const runtime = createSchemaIdeArtifactRuntime({
    ...(schema ? { schema } : {}),
    files,
    activeFile: selectedActiveFile,
    activeFormat,
    ...(project ? { project } : {}),
    ...(projectId ? { projectId } : {}),
  });

  return createArtifactRuntimeWorkspaceClient(runtime, {
    title,
    projectId,
    readOnly,
    agentEnabled,
  });
}

function createArtifactRuntimeWorkspaceClient(
  artifacts: SchemaIdeArtifactRuntime,
  {
    title,
    projectId,
    readOnly = false,
    agentEnabled = true,
  }: CreateArtifactRuntimeWorkspaceClientOptions = {},
): SchemaIdeArtifactProjectService {
  let revision = 0;
  const versionedStore = createVersionedArtifactStore(artifacts.store);
  const subscribers = new Set<(event: ArtifactProjectEvent) => void>();
  const projectMetadata = { title, readOnly, ...(projectId ? { id: projectId } : {}) };
  const capabilities: ArtifactProjectCapabilities = {
    mode: "memory",
    project: projectMetadata,
    agent: {
      enabled: agentEnabled,
      ...(agentEnabled ? {} : { reason: "Agent is disabled for this workspace." }),
    },
    features: {
      watch: true,
      write: !readOnly,
      rename: !readOnly,
      delete: !readOnly,
      history: true,
      previews: true,
    },
  };

  const snapshot = Effect.gen(function* () {
    const files = yield* artifacts.files.pipe(Effect.mapError(toWorkspaceError));
    return { revision, files };
  });

  const publish = () => {
    Effect.runFork(
      snapshot.pipe(
        Effect.tap((next) =>
          Effect.sync(() => {
            const event: ArtifactProjectEvent = { type: "snapshot", snapshot: next };
            for (const subscriber of subscribers) subscriber(event);
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => {
            const event: ArtifactProjectEvent = { type: "error", message: error.message };
            for (const subscriber of subscribers) subscriber(event);
          }),
        ),
      ),
    );
  };

  const applyChange = (
    change: ArtifactProjectChangeRequest,
  ): Effect.Effect<ArtifactProjectSnapshot, SchemaIdeArtifactProjectError> =>
    Effect.gen(function* () {
      if (readOnly) {
        return yield* Effect.fail(
          new SchemaIdeArtifactProjectError("Workspace is read-only.", "read-only"),
        );
      }

      const refs = yield* artifacts.store.list.pipe(Effect.mapError(toWorkspaceError));
      const artifactChange = yield* workspaceChangeToArtifactStoreChange(
        artifacts,
        refs,
        change,
        projectId,
      );
      yield* versionedStore
        .apply(artifactChange, {
          actor: "user",
          label: workspaceChangeLabel(change),
        })
        .pipe(Effect.mapError(toWorkspaceError));

      revision += 1;
      const next = yield* snapshot;
      publish();
      return next;
    });
  const watchArtifactProject = Stream.callback<ArtifactProjectEvent, SchemaIdeArtifactProjectError>(
    (queue) =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          const subscriber = (event: ArtifactProjectEvent) => Queue.offerUnsafe(queue, event);
          subscribers.add(subscriber);
          Queue.offerUnsafe(queue, { type: "capabilities", capabilities });
          Queue.offerUnsafe(queue, { type: "snapshot", snapshot: yield* snapshot });
          return subscriber;
        }),
        (subscriber) => Effect.sync(() => subscribers.delete(subscriber)),
      ),
  );

  return {
    getCapabilities: Effect.succeed(capabilities),
    getSnapshot: snapshot,
    watchArtifactProject,
    applyChange: (change) =>
      Effect.gen(function* () {
        const before = yield* artifacts.files.pipe(Effect.mapError(toWorkspaceError));
        const next = yield* applyChange(change);
        const validationSummary = yield* readValidationSummary(artifacts, projectId);
        return {
          revision: next.revision,
          changedPaths: changedPathsForChange(change, before),
          validationSummary,
        };
      }),
    previewFiles: (request) =>
      artifacts.preview(request.files, request.activeFile).pipe(
        Effect.map((reflection) => ({ reflection })),
        Effect.mapError(toWorkspaceError),
      ),
    listArtifactRefs: Effect.gen(function* () {
      const refs = yield* artifacts.store.list.pipe(Effect.mapError(toWorkspaceError));
      const workspaceRef = ArtifactRef.project(projectId);
      const artifactRefs = [workspaceRef, ...refs.filter(isProtocolArtifactRef)];
      return {
        artifacts: artifactRefs,
        count: artifactRefs.length,
      };
    }),
    getArtifactCapabilities: (request) =>
      Effect.gen(function* () {
        const ref = yield* normalizeArtifactRef(artifacts, request.ref, projectId);
        return {
          capabilities: artifacts.capabilities(ref).map(protocolCapability),
        };
      }),
    readArtifactView: (request) =>
      Effect.gen(function* () {
        const ref = yield* normalizeArtifactRef(artifacts, request.ref, projectId);
        const value = yield* artifacts
          .view(ref, request.view)
          .pipe(Effect.mapError(toWorkspaceError));
        return { ref: request.ref, view: request.view, value };
      }),
    applyArtifactChange: (change) =>
      Effect.gen(function* () {
        const workspaceChange = artifactChangeToProjectChange(change);
        const before = yield* artifacts.files.pipe(Effect.mapError(toWorkspaceError));
        const next = yield* applyChange(workspaceChange);
        const validationSummary = yield* readValidationSummary(artifacts, projectId);
        return {
          revision: next.revision,
          changedPaths: changedPathsForChange(workspaceChange, before),
          validationSummary,
        };
      }),
  };
}

export function createRpcArtifactProjectClient(
  baseUrl = "",
  rpcPath = "/v1/artifact-project/rpc",
): SchemaIdeArtifactProjectService {
  const url = `${baseUrl.replace(/\/$/, "")}${rpcPath.startsWith("/") ? rpcPath : `/${rpcPath}`}`;
  const makeClient = RpcClient.make(SchemaIdeArtifactProjectRpcGroup).pipe(
    Effect.provide(RpcClient.layerProtocolHttp({ url })),
    Effect.provide(RpcSerialization.layerNdjson),
    Effect.provide(FetchHttpClient.layer),
  );

  return {
    getCapabilities: Effect.scoped(
      Effect.flatMap(makeClient, (client) => client.GetCapabilities(undefined)),
    ).pipe(Effect.mapError(toRpcWorkspaceError)),
    getSnapshot: Effect.scoped(
      Effect.flatMap(makeClient, (client) => client.GetSnapshot(undefined)),
    ).pipe(Effect.mapError(toRpcWorkspaceError)),
    watchArtifactProject: Stream.unwrap(
      makeClient.pipe(Effect.map((client) => client.WatchArtifactProject(undefined))),
    ).pipe(Stream.scoped, Stream.mapError(toRpcWorkspaceError)),
    applyChange: (change) =>
      Effect.scoped(
        Effect.flatMap(makeClient, (client) => client.ApplyArtifactProjectChange(change)),
      ).pipe(Effect.mapError(toRpcWorkspaceError)),
    previewFiles: (request) =>
      Effect.scoped(
        Effect.flatMap(makeClient, (client) => client.PreviewArtifactProjectFiles(request)),
      ).pipe(Effect.mapError(toRpcWorkspaceError)),
    listArtifactRefs: Effect.scoped(
      Effect.flatMap(makeClient, (client) => client.ListArtifactRefs(undefined)),
    ).pipe(Effect.mapError(toRpcWorkspaceError)),
    getArtifactCapabilities: (request) =>
      Effect.scoped(
        Effect.flatMap(makeClient, (client) => client.GetArtifactCapabilities(request)),
      ).pipe(Effect.mapError(toRpcWorkspaceError)),
    readArtifactView: (request) =>
      Effect.scoped(Effect.flatMap(makeClient, (client) => client.ReadArtifactView(request))).pipe(
        Effect.mapError(toRpcWorkspaceError),
      ),
    applyArtifactChange: (change) =>
      Effect.scoped(
        Effect.flatMap(makeClient, (client) => client.ApplyArtifactChange(change)),
      ).pipe(Effect.mapError(toRpcWorkspaceError)),
  };
}

function readValidationSummary(
  artifacts: SchemaIdeArtifactRuntime,
  projectId: string | undefined,
): Effect.Effect<SchemaIdeValidationSummaryDto, SchemaIdeArtifactProjectError> {
  return artifacts.view(ArtifactRef.project(projectId), "validationSummary").pipe(
    Effect.flatMap((value) =>
      isSchemaIdeValidationSummary(value)
        ? Effect.succeed(value)
        : Effect.fail(
            new SchemaIdeArtifactProjectError(
              "Artifact validationSummary view returned an invalid value.",
              "storage",
            ),
          ),
    ),
    Effect.mapError(toWorkspaceError),
  );
}

function isSchemaIdeValidationSummary(value: unknown): value is SchemaIdeValidationSummaryDto {
  if (!value || typeof value !== "object") return false;
  const summary = value as Record<string, unknown>;
  return (
    typeof summary["valid"] === "boolean" &&
    typeof summary["errorCount"] === "number" &&
    typeof summary["warningCount"] === "number" &&
    typeof summary["infoCount"] === "number"
  );
}

function workspaceChangeLabel(change: ArtifactProjectChangeRequest): string {
  switch (change.type) {
    case "writeFile":
      return `Write ${change.path}`;
    case "createFile":
      return `Create ${change.path}`;
    case "deleteFile":
      return `Delete ${change.path}`;
    case "renameFile":
      return `Rename ${change.fromPath}`;
    case "replaceFiles":
      return "Replace files";
  }
}

function changedPathsForChange(
  change: ArtifactProjectChangeRequest,
  before: readonly SourceFile[],
): readonly string[] {
  switch (change.type) {
    case "writeFile":
    case "createFile":
    case "deleteFile":
      return [change.path];
    case "renameFile":
      return [change.fromPath, change.toPath];
    case "replaceFiles": {
      const beforeByPath = new Map(before.map((file) => [file.path, file.content]));
      return change.files
        .filter((file) => beforeByPath.get(file.path) !== file.content)
        .map((file) => file.path);
    }
  }
}

function protocolCapability(
  capability: ReturnType<SchemaIdeArtifactRuntime["capabilities"]>[number],
) {
  return {
    id: capability.id,
    type: capability.type,
    view: capability.view,
    annotations: capability.annotations,
    ...("routeId" in capability && capability.routeId ? { routeId: capability.routeId } : {}),
    ...("routePattern" in capability && capability.routePattern
      ? { routePattern: capability.routePattern }
      : {}),
  };
}

function isProtocolArtifactRef(ref: ArtifactRefDefinition) {
  return ref._tag === "ProjectFile" || ref._tag === "Project";
}

function refForPath(
  path: string,
  refs: readonly ArtifactRefDefinition[],
  projectId: string | undefined,
) {
  return (
    refs.find((ref) => ref._tag === "ProjectFile" && ref.path === path) ??
    ArtifactRef.projectFile(path, projectId)
  );
}

function normalizeArtifactRef(
  artifacts: SchemaIdeArtifactRuntime,
  ref: ArtifactRefDefinition,
  projectId: string | undefined,
) {
  if (ref._tag !== "ProjectFile") return Effect.succeed(ref);
  return artifacts.store.list.pipe(
    Effect.map((refs) => refForPath(ref.path, refs, ref.projectId ?? projectId)),
    Effect.mapError(toWorkspaceError),
  );
}

function workspaceChangeToArtifactStoreChange(
  artifacts: SchemaIdeArtifactRuntime,
  refs: readonly ArtifactRefDefinition[],
  change: ArtifactProjectChangeRequest,
  projectId: string | undefined,
): Effect.Effect<ArtifactStoreChange, SchemaIdeArtifactProjectError> {
  switch (change.type) {
    case "writeFile":
      return Effect.succeed({
        type: "write",
        ref: refForPath(change.path, refs, projectId),
        content: change.content,
      });
    case "createFile":
      return Effect.succeed({
        type: "create",
        ref: ArtifactRef.projectFile(change.path, projectId),
        content: change.content,
      });
    case "deleteFile":
      return Effect.succeed({
        type: "delete",
        ref: refForPath(change.path, refs, projectId),
      });
    case "renameFile":
      return Effect.gen(function* () {
        const from = refs.find((ref) => ref._tag === "ProjectFile" && ref.path === change.fromPath);
        if (!from) {
          return yield* Effect.fail(
            new SchemaIdeArtifactProjectError("Artifact not found.", "not-found"),
          );
        }
        const to = ArtifactRef.projectFile(change.toPath, projectId);
        if (
          change.fromPath !== change.toPath &&
          refs.some((ref) => ref._tag === "ProjectFile" && ref.path === change.toPath)
        ) {
          return yield* Effect.fail(
            new SchemaIdeArtifactProjectError("Artifact already exists.", "already-exists"),
          );
        }
        const entries = yield* artifactStoreEntries(artifacts, refs);
        return {
          type: "replace",
          entries: entries.map((entry) => (entry.ref === from ? { ...entry, ref: to } : entry)),
        } satisfies ArtifactStoreChange;
      });
    case "replaceFiles":
      return Effect.succeed({
        type: "replace",
        entries: sourceFilesToArtifactStoreEntries(change.files, projectId),
      });
  }
}

function sourceFilesToArtifactStoreEntries(
  files: readonly SourceFile[],
  projectId: string | undefined,
): readonly ArtifactStoreEntry[] {
  return files.map((file) => ({
    ref: ArtifactRef.projectFile(file.path, projectId),
    content: file.content,
  }));
}

function artifactStoreEntries(
  artifacts: SchemaIdeArtifactRuntime,
  refs: readonly ArtifactRefDefinition[],
): Effect.Effect<readonly ArtifactStoreEntry[], SchemaIdeArtifactProjectError> {
  return Effect.forEach(
    refs.filter((ref) => ref._tag === "ProjectFile"),
    (ref) =>
      artifacts.store.read(ref).pipe(
        Effect.map((content) => ({ ref, content })),
        Effect.mapError(toWorkspaceError),
      ),
  );
}

function toWorkspaceError(error: unknown): SchemaIdeArtifactProjectError {
  if (error instanceof SchemaIdeArtifactProjectError) return error;
  if (typeof error === "object" && error !== null && "_tag" in error) {
    const tag = String(error._tag);
    if (
      tag === "ArtifactTypeNotFound" ||
      tag === "ArtifactViewNotFound" ||
      tag === "ArtifactHandlerNotFound" ||
      tag === "ArtifactUnexpectedInput"
    ) {
      return new SchemaIdeArtifactProjectError("Unsupported artifact operation.", "unsupported");
    }
    if (tag === "ArtifactSchemaValidationError") {
      return new SchemaIdeArtifactProjectError("Artifact schema validation failed.", "storage");
    }
  }
  if (typeof error === "object" && error !== null && "reason" in error) {
    const reason = String(error.reason);
    if (reason === "not-found") {
      return new SchemaIdeArtifactProjectError("Artifact not found.", "not-found");
    }
    if (reason === "already-exists") {
      return new SchemaIdeArtifactProjectError("Artifact already exists.", "already-exists");
    }
    return new SchemaIdeArtifactProjectError("Unsupported artifact ref.", "unsupported");
  }
  return new SchemaIdeArtifactProjectError(
    error instanceof Error ? error.message : String(error),
    "storage",
  );
}

function toRpcWorkspaceError(error: unknown): SchemaIdeArtifactProjectError {
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    return artifactProjectRpcErrorToError(
      error as Parameters<typeof artifactProjectRpcErrorToError>[0],
    );
  }
  return toWorkspaceError(error);
}
