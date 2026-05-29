import {
  Workspace,
  applyWorkspaceChange,
  codecForPath,
  createSchemaIdeArtifactRuntime,
  createVersionedWorkspace,
  stringifyDocument,
  type SchemaIdeArtifactRuntime,
  type SchemaIdeDocumentFormat,
  type SchemaIdeInputSchema,
  type SourceFile,
  type VersionedWorkspaceState,
  type WorkspaceRouteMap,
} from "@schema-ide/core";
import {
  SchemaIdeWorkspaceError,
  SchemaIdeWorkspaceRpcGroup,
  artifactChangeToWorkspaceChange,
  workspaceRpcErrorToError,
  type SchemaIdeWorkspaceService,
  type WorkspaceCapabilities,
  type WorkspaceChangeRequest,
  type WorkspaceEvent,
  type WorkspacePreviewRequest,
  type WorkspacePreviewResponse,
  type WorkspaceSnapshot,
} from "@schema-ide/protocol";
import {
  ArtifactRef,
  type ArtifactProjectDeclaration,
  type ArtifactRefDefinition,
} from "@schema-ide/artifacts";
import { Effect, Queue, Stream } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

export interface CreateMemoryWorkspaceClientOptions<
  A = unknown,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
> {
  readonly schema: SchemaIdeInputSchema<A, Routes>;
  readonly defaultFormat?: SchemaIdeDocumentFormat | undefined;
  readonly artifactProject?: ArtifactProjectDeclaration<string, any, any> | undefined;
  readonly initialFiles?: readonly SourceFile[] | undefined;
  readonly initialValue?: A | undefined;
  readonly value?: A | undefined;
  readonly readOnly?: boolean | undefined;
  readonly title?: string | undefined;
  readonly agentEnabled?: boolean | undefined;
}

export interface CreateArtifactWorkspaceClientOptions {
  readonly title?: string | undefined;
  readonly workspaceId?: string | undefined;
  readonly readOnly?: boolean | undefined;
  readonly agentEnabled?: boolean | undefined;
}

export interface CreateProjectWorkspaceClientOptions<
  A = unknown,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
> extends CreateArtifactWorkspaceClientOptions {
  readonly project: ArtifactProjectDeclaration<string, any, any>;
  readonly schema?: SchemaIdeInputSchema<A, Routes> | undefined;
  readonly defaultFormat?: SchemaIdeDocumentFormat | undefined;
  readonly activeFile?: string | null | undefined;
  readonly initialFiles?: readonly SourceFile[] | undefined;
  readonly initialValue?: A | undefined;
  readonly value?: A | undefined;
}

export function createMemoryWorkspaceClient<
  A,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
>({
  schema,
  defaultFormat = "json",
  artifactProject,
  initialFiles,
  initialValue,
  value,
  readOnly = false,
  title,
  agentEnabled = true,
}: CreateMemoryWorkspaceClientOptions<A, Routes>): SchemaIdeWorkspaceService {
  let workspace = createVersionedWorkspace(
    initialFiles?.length
      ? initialFiles
      : [
          {
            path: `document.${defaultFormat === "yaml" ? "yaml" : "json"}`,
            content: stringifyDocument(value ?? initialValue ?? {}, defaultFormat),
          },
        ],
  );
  let revision = 0;
  const subscribers = new Set<(event: WorkspaceEvent) => void>();
  const capabilities: WorkspaceCapabilities = {
    mode: "memory",
    workspace: { title, readOnly },
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

  const artifactRuntime = (
    targetWorkspace: VersionedWorkspaceState = workspace,
    activeFile?: string | null | undefined,
  ) => {
    const selection = selectMemoryActiveFile(targetWorkspace, defaultFormat, activeFile);
    return createSchemaIdeArtifactRuntime({
      schema,
      files: targetWorkspace.files,
      activeFile: selection.activeFile,
      activeFormat: selection.activeFormat,
      ...(artifactProject ? { project: artifactProject } : {}),
    });
  };

  const snapshot = (): Effect.Effect<WorkspaceSnapshot, SchemaIdeWorkspaceError> =>
    Effect.gen(function* () {
      const runtime = artifactRuntime();
      const reflection = yield* runtime.reflection.pipe(Effect.mapError(toWorkspaceError));
      return { revision, files: workspace.files, reflection };
    });

  const previewFiles = (
    request: WorkspacePreviewRequest,
  ): Effect.Effect<WorkspacePreviewResponse, SchemaIdeWorkspaceError> =>
    Effect.gen(function* () {
      const reflection = yield* artifactRuntime(
        createVersionedWorkspace(request.files),
        request.activeFile,
      ).reflection.pipe(Effect.mapError(toWorkspaceError));
      return { reflection };
    });

  const publish = () => {
    Effect.runFork(
      snapshot().pipe(
        Effect.tap((next) =>
          Effect.sync(() => {
            const event: WorkspaceEvent = { type: "snapshot", snapshot: next };
            for (const subscriber of subscribers) subscriber(event);
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => {
            const event: WorkspaceEvent = { type: "error", message: error.message };
            for (const subscriber of subscribers) subscriber(event);
          }),
        ),
      ),
    );
  };
  const watchWorkspace = Stream.callback<WorkspaceEvent, SchemaIdeWorkspaceError>((queue) =>
    Effect.acquireRelease(
      Effect.gen(function* () {
        const subscriber = (event: WorkspaceEvent) => Queue.offerUnsafe(queue, event);
        subscribers.add(subscriber);
        Queue.offerUnsafe(queue, { type: "capabilities", capabilities });
        Queue.offerUnsafe(queue, { type: "snapshot", snapshot: yield* snapshot() });
        return subscriber;
      }),
      (subscriber) => Effect.sync(() => subscribers.delete(subscriber)),
    ),
  );

  return {
    getCapabilities: Effect.succeed(capabilities),
    getSnapshot: snapshot(),
    watchWorkspace,
    watchArtifactProject: watchWorkspace,
    applyChange: (change) =>
      Effect.gen(function* () {
        const before = workspace.files;
        yield* Effect.try({
          try: () => {
            if (readOnly) {
              throw new SchemaIdeWorkspaceError("Workspace is read-only.", "read-only");
            }
            workspace = applyWorkspaceChange(workspace, change, {
              actor: "user",
              label: workspaceChangeLabel(change),
            });
            revision += 1;
          },
          catch: toWorkspaceError,
        });
        const next = yield* snapshot();
        publish();
        return {
          revision,
          changedPaths: changedPathsForChange(change, before),
          validationSummary: next.reflection.validationSummary,
        };
      }),
    previewFiles,
    listArtifactRefs: Effect.gen(function* () {
      const runtime = artifactRuntime();
      const refs = yield* runtime.store.list.pipe(Effect.mapError(toWorkspaceError));
      const artifactRefs = [ArtifactRef.workspace(), ...refs.filter(isProtocolArtifactRef)];
      return {
        artifacts: artifactRefs,
        count: artifactRefs.length,
      };
    }),
    getArtifactCapabilities: (request) =>
      Effect.gen(function* () {
        const runtime = artifactRuntime();
        const ref = yield* normalizeArtifactRef(runtime, request.ref, undefined);
        return {
          capabilities: runtime.capabilities(ref).map(protocolCapability),
        };
      }),
    readArtifactView: (request) =>
      Effect.gen(function* () {
        const runtime = artifactRuntime();
        const ref = yield* normalizeArtifactRef(runtime, request.ref, undefined);
        const value = yield* runtime
          .view(ref, request.view)
          .pipe(Effect.mapError(toWorkspaceError));
        return { ref: request.ref, view: request.view, value };
      }),
    applyArtifactChange: (change) =>
      Effect.flatMap(Effect.succeed(artifactChangeToWorkspaceChange(change)), (workspaceChange) => {
        const before = workspace.files;
        return Effect.try({
          try: () => {
            if (readOnly) {
              throw new SchemaIdeWorkspaceError("Workspace is read-only.", "read-only");
            }
            workspace = applyWorkspaceChange(workspace, workspaceChange, {
              actor: "user",
              label: workspaceChangeLabel(workspaceChange),
            });
            revision += 1;
          },
          catch: toWorkspaceError,
        }).pipe(
          Effect.flatMap(() =>
            snapshot().pipe(
              Effect.map((next) => {
                publish();
                return {
                  revision,
                  changedPaths: changedPathsForChange(workspaceChange, before),
                  validationSummary: next.reflection.validationSummary,
                };
              }),
            ),
          ),
        );
      }),
  };
}

export function createArtifactWorkspaceClient(
  artifacts: SchemaIdeArtifactRuntime,
  {
    title,
    workspaceId,
    readOnly = false,
    agentEnabled = true,
  }: CreateArtifactWorkspaceClientOptions = {},
): SchemaIdeWorkspaceService {
  let revision = 0;
  const subscribers = new Set<(event: WorkspaceEvent) => void>();
  const capabilities: WorkspaceCapabilities = {
    mode: "memory",
    workspace: { title, readOnly, ...(workspaceId ? { id: workspaceId } : {}) },
    agent: {
      enabled: agentEnabled,
      ...(agentEnabled ? {} : { reason: "Agent is disabled for this workspace." }),
    },
    features: {
      watch: true,
      write: !readOnly,
      rename: !readOnly,
      delete: !readOnly,
      history: false,
      previews: true,
    },
  };

  const snapshot = Effect.gen(function* () {
    const files = yield* artifacts.files.pipe(Effect.mapError(toWorkspaceError));
    const reflection = yield* artifacts.reflection.pipe(Effect.mapError(toWorkspaceError));
    return { revision, files, reflection };
  });

  const publish = () => {
    Effect.runFork(
      snapshot.pipe(
        Effect.tap((next) =>
          Effect.sync(() => {
            const event: WorkspaceEvent = { type: "snapshot", snapshot: next };
            for (const subscriber of subscribers) subscriber(event);
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => {
            const event: WorkspaceEvent = { type: "error", message: error.message };
            for (const subscriber of subscribers) subscriber(event);
          }),
        ),
      ),
    );
  };

  const applyChange = (
    change: WorkspaceChangeRequest,
  ): Effect.Effect<WorkspaceSnapshot, SchemaIdeWorkspaceError> =>
    Effect.gen(function* () {
      if (readOnly) {
        return yield* Effect.fail(
          new SchemaIdeWorkspaceError("Workspace is read-only.", "read-only"),
        );
      }

      const refs = yield* artifacts.store.list.pipe(Effect.mapError(toWorkspaceError));

      switch (change.type) {
        case "writeFile": {
          const ref = refForPath(change.path, refs, workspaceId);
          yield* artifacts.store.write(ref, change.content).pipe(Effect.mapError(toWorkspaceError));
          break;
        }
        case "createFile": {
          const ref = refForPath(change.path, refs, workspaceId);
          yield* artifacts.store
            .create(ref, change.content)
            .pipe(Effect.mapError(toWorkspaceError));
          break;
        }
        case "deleteFile": {
          const ref = refForPath(change.path, refs, workspaceId);
          yield* artifacts.store.delete(ref).pipe(Effect.mapError(toWorkspaceError));
          break;
        }
        case "renameFile": {
          const from = refForPath(change.fromPath, refs, workspaceId);
          const content = yield* artifacts.store.read(from).pipe(Effect.mapError(toWorkspaceError));
          const to = refForPath(change.toPath, refs, workspaceId);
          yield* artifacts.store.create(to, content).pipe(Effect.mapError(toWorkspaceError));
          yield* artifacts.store.delete(from).pipe(Effect.mapError(toWorkspaceError));
          break;
        }
        case "replaceFiles":
          yield* replaceArtifactFiles(artifacts, refs, change.files, workspaceId);
          break;
      }

      revision += 1;
      const next = yield* snapshot;
      publish();
      return {
        ...next,
        files: next.files,
        reflection: next.reflection,
        revision,
      };
    });
  const watchWorkspace = Stream.callback<WorkspaceEvent, SchemaIdeWorkspaceError>((queue) =>
    Effect.acquireRelease(
      Effect.gen(function* () {
        const subscriber = (event: WorkspaceEvent) => Queue.offerUnsafe(queue, event);
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
    watchWorkspace,
    watchArtifactProject: watchWorkspace,
    applyChange: (change) =>
      Effect.gen(function* () {
        const before = yield* artifacts.files.pipe(Effect.mapError(toWorkspaceError));
        const next = yield* applyChange(change);
        return {
          revision: next.revision,
          changedPaths: changedPathsForChange(change, before),
          validationSummary: next.reflection.validationSummary,
        };
      }),
    previewFiles: (request) =>
      artifacts.preview(request.files, request.activeFile).pipe(
        Effect.map((reflection) => ({ reflection })),
        Effect.mapError(toWorkspaceError),
      ),
    listArtifactRefs: Effect.gen(function* () {
      const refs = yield* artifacts.store.list.pipe(Effect.mapError(toWorkspaceError));
      const workspaceRef = ArtifactRef.workspace(workspaceId);
      const artifactRefs = [workspaceRef, ...refs.filter(isProtocolArtifactRef)];
      return {
        artifacts: artifactRefs,
        count: artifactRefs.length,
      };
    }),
    getArtifactCapabilities: (request) =>
      Effect.gen(function* () {
        const ref = yield* normalizeArtifactRef(artifacts, request.ref, workspaceId);
        return {
          capabilities: artifacts.capabilities(ref).map(protocolCapability),
        };
      }),
    readArtifactView: (request) =>
      Effect.gen(function* () {
        const ref = yield* normalizeArtifactRef(artifacts, request.ref, workspaceId);
        const value = yield* artifacts
          .view(ref, request.view)
          .pipe(Effect.mapError(toWorkspaceError));
        return { ref: request.ref, view: request.view, value };
      }),
    applyArtifactChange: (change) =>
      Effect.gen(function* () {
        const workspaceChange = artifactChangeToWorkspaceChange(change);
        const before = yield* artifacts.files.pipe(Effect.mapError(toWorkspaceError));
        const next = yield* applyChange(workspaceChange);
        return {
          revision: next.revision,
          changedPaths: changedPathsForChange(workspaceChange, before),
          validationSummary: next.reflection.validationSummary,
        };
      }),
  };
}

export function createProjectWorkspaceClient<
  A,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
>({
  project,
  schema,
  defaultFormat = "json",
  activeFile,
  initialFiles,
  initialValue,
  value,
  title,
  workspaceId = project.name,
  readOnly,
  agentEnabled,
}: CreateProjectWorkspaceClientOptions<A, Routes>): SchemaIdeWorkspaceService {
  const resolvedSchema =
    schema ??
    (Workspace.fromArtifactProject(project) as unknown as SchemaIdeInputSchema<A, Routes>);
  const files = initialFiles?.length
    ? initialFiles
    : initialValue !== undefined || value !== undefined
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
  const artifacts = createSchemaIdeArtifactRuntime({
    schema: resolvedSchema,
    files,
    activeFile: selectedActiveFile,
    activeFormat,
    project,
    workspaceId,
  });

  return createArtifactWorkspaceClient(artifacts, {
    title,
    workspaceId,
    readOnly,
    agentEnabled,
  });
}

export function createRpcWorkspaceClient(
  baseUrl = "",
  rpcPath = "/v1/workspace/rpc",
): SchemaIdeWorkspaceService {
  const url = `${baseUrl.replace(/\/$/, "")}${rpcPath.startsWith("/") ? rpcPath : `/${rpcPath}`}`;
  const makeClient = RpcClient.make(SchemaIdeWorkspaceRpcGroup).pipe(
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
    watchWorkspace: Stream.unwrap(
      makeClient.pipe(Effect.map((client) => client.WatchWorkspace(undefined))),
    ).pipe(Stream.scoped, Stream.mapError(toRpcWorkspaceError)),
    watchArtifactProject: Stream.unwrap(
      makeClient.pipe(Effect.map((client) => client.WatchArtifactProject(undefined))),
    ).pipe(Stream.scoped, Stream.mapError(toRpcWorkspaceError)),
    applyChange: (change) =>
      Effect.scoped(
        Effect.flatMap(makeClient, (client) => client.ApplyWorkspaceChange(change)),
      ).pipe(Effect.mapError(toRpcWorkspaceError)),
    previewFiles: (request) =>
      Effect.scoped(
        Effect.flatMap(makeClient, (client) => client.PreviewWorkspaceFiles(request)),
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

function selectMemoryActiveFile(
  workspace: VersionedWorkspaceState,
  defaultFormat: SchemaIdeDocumentFormat,
  requestedActiveFile?: string | null | undefined,
): {
  readonly activeFile: string | null;
  readonly activeFormat: SchemaIdeDocumentFormat;
} {
  const activeFile: string | null =
    requestedActiveFile && workspace.files.some((file) => file.path === requestedActiveFile)
      ? requestedActiveFile
      : (workspace.files[0]?.path ?? null);
  return {
    activeFile,
    activeFormat: activeFile ? codecForPath(activeFile, defaultFormat).format : defaultFormat,
  };
}

function workspaceChangeLabel(change: WorkspaceChangeRequest): string {
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
  change: WorkspaceChangeRequest,
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
  return ref._tag === "WorkspaceFile" || ref._tag === "Workspace";
}

function refForPath(
  path: string,
  refs: readonly ArtifactRefDefinition[],
  workspaceId: string | undefined,
) {
  return (
    refs.find((ref) => ref._tag === "WorkspaceFile" && ref.path === path) ??
    ArtifactRef.workspaceFile(path, workspaceId)
  );
}

function normalizeArtifactRef(
  artifacts: SchemaIdeArtifactRuntime,
  ref: ArtifactRefDefinition,
  workspaceId: string | undefined,
) {
  if (ref._tag !== "WorkspaceFile") return Effect.succeed(ref);
  return artifacts.store.list.pipe(
    Effect.map((refs) => refForPath(ref.path, refs, ref.workspaceId ?? workspaceId)),
    Effect.mapError(toWorkspaceError),
  );
}

function replaceArtifactFiles(
  artifacts: SchemaIdeArtifactRuntime,
  refs: readonly ArtifactRefDefinition[],
  files: readonly SourceFile[],
  workspaceId: string | undefined,
): Effect.Effect<void, SchemaIdeWorkspaceError> {
  return Effect.gen(function* () {
    const nextByPath = new Map(files.map((file) => [file.path, file.content]));
    for (const ref of refs) {
      if (ref._tag !== "WorkspaceFile") continue;
      const content = nextByPath.get(ref.path);
      if (content === undefined) {
        yield* artifacts.store.delete(ref).pipe(Effect.mapError(toWorkspaceError));
      } else {
        yield* artifacts.store.write(ref, content).pipe(Effect.mapError(toWorkspaceError));
        nextByPath.delete(ref.path);
      }
    }

    for (const [path, content] of nextByPath) {
      yield* artifacts.store
        .create(ArtifactRef.workspaceFile(path, workspaceId), content)
        .pipe(Effect.mapError(toWorkspaceError));
    }
  });
}

function toWorkspaceError(error: unknown): SchemaIdeWorkspaceError {
  if (error instanceof SchemaIdeWorkspaceError) return error;
  if (typeof error === "object" && error !== null && "_tag" in error) {
    const tag = String(error._tag);
    if (
      tag === "ArtifactTypeNotFound" ||
      tag === "ArtifactViewNotFound" ||
      tag === "ArtifactHandlerNotFound" ||
      tag === "ArtifactUnexpectedInput"
    ) {
      return new SchemaIdeWorkspaceError("Unsupported artifact operation.", "unsupported");
    }
    if (tag === "ArtifactSchemaValidationError") {
      return new SchemaIdeWorkspaceError("Artifact schema validation failed.", "storage");
    }
  }
  if (typeof error === "object" && error !== null && "reason" in error) {
    const reason = String(error.reason);
    if (reason === "not-found") {
      return new SchemaIdeWorkspaceError("Artifact not found.", "not-found");
    }
    if (reason === "already-exists") {
      return new SchemaIdeWorkspaceError("Artifact already exists.", "already-exists");
    }
    return new SchemaIdeWorkspaceError("Unsupported artifact ref.", "unsupported");
  }
  return new SchemaIdeWorkspaceError(
    error instanceof Error ? error.message : String(error),
    "storage",
  );
}

function toRpcWorkspaceError(error: unknown): SchemaIdeWorkspaceError {
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    return workspaceRpcErrorToError(error as Parameters<typeof workspaceRpcErrorToError>[0]);
  }
  return toWorkspaceError(error);
}
