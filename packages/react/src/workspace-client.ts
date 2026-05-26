import {
  applyWorkspaceChange,
  createReflection,
  createVersionedWorkspace,
  type SchemaIdeDocumentFormat,
  type SchemaIdeInputSchema,
  type SourceFile,
  type VersionedWorkspaceState,
  type WorkspaceRouteMap,
} from "@schema-ide/core";
import {
  SchemaIdeWorkspaceError,
  SchemaIdeWorkspaceRpcGroup,
  workspaceRpcErrorToError,
  type SchemaIdeWorkspaceService,
  type WorkspaceCapabilities,
  type WorkspaceChangeRequest,
  type WorkspaceEvent,
  type WorkspacePreviewRequest,
  type WorkspacePreviewResponse,
  type WorkspaceSnapshot,
} from "@schema-ide/protocol";
import { codecForPath, stringifyDocument, validateSchemaIdeValue } from "@schema-ide/core";
import { Effect, Queue, Stream } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

export interface CreateMemoryWorkspaceClientOptions<
  A = unknown,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
> {
  readonly schema: SchemaIdeInputSchema<A, Routes>;
  readonly defaultFormat?: SchemaIdeDocumentFormat | undefined;
  readonly initialFiles?: readonly SourceFile[] | undefined;
  readonly initialValue?: A | undefined;
  readonly value?: A | undefined;
  readonly readOnly?: boolean | undefined;
  readonly title?: string | undefined;
  readonly agentEnabled?: boolean | undefined;
}

export function createMemoryWorkspaceClient<
  A,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
>({
  schema,
  defaultFormat = "json",
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

  const snapshot = (): WorkspaceSnapshot =>
    makeMemorySnapshot({
      schema,
      workspace,
      revision,
      defaultFormat,
    });
  const previewFiles = (request: WorkspacePreviewRequest): WorkspacePreviewResponse => ({
    reflection: makeMemorySnapshot({
      schema,
      workspace: createVersionedWorkspace(request.files),
      revision,
      defaultFormat,
      activeFile: request.activeFile,
    }).reflection,
  });
  const publish = () => {
    const event: WorkspaceEvent = { type: "snapshot", snapshot: snapshot() };
    for (const subscriber of subscribers) subscriber(event);
  };

  return {
    getCapabilities: Effect.succeed(capabilities),
    getSnapshot: Effect.sync(snapshot),
    watchWorkspace: Stream.callback<WorkspaceEvent, SchemaIdeWorkspaceError>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const subscriber = (event: WorkspaceEvent) => Queue.offerUnsafe(queue, event);
          subscribers.add(subscriber);
          Queue.offerUnsafe(queue, { type: "capabilities", capabilities });
          Queue.offerUnsafe(queue, { type: "snapshot", snapshot: snapshot() });
          return subscriber;
        }),
        (subscriber) => Effect.sync(() => subscribers.delete(subscriber)),
      ),
    ),
    applyChange: (change) =>
      Effect.try({
        try: () => {
          if (readOnly) {
            throw new SchemaIdeWorkspaceError("Workspace is read-only.", "read-only");
          }
          const before = workspace.files;
          workspace = applyWorkspaceChange(workspace, change, {
            actor: "user",
            label: workspaceChangeLabel(change),
          });
          revision += 1;
          publish();
          return {
            revision,
            changedPaths: changedPathsForChange(change, before),
            validationSummary: snapshot().reflection.validationSummary,
          };
        },
        catch: toWorkspaceError,
      }),
    previewFiles: (request) => Effect.sync(() => previewFiles(request)),
  };
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
    applyChange: (change) =>
      Effect.scoped(
        Effect.flatMap(makeClient, (client) => client.ApplyWorkspaceChange(change)),
      ).pipe(Effect.mapError(toRpcWorkspaceError)),
    previewFiles: (request) =>
      Effect.scoped(
        Effect.flatMap(makeClient, (client) => client.PreviewWorkspaceFiles(request)),
      ).pipe(Effect.mapError(toRpcWorkspaceError)),
  };
}

function makeMemorySnapshot<A, Routes extends WorkspaceRouteMap>({
  schema,
  workspace,
  revision,
  defaultFormat,
  activeFile: requestedActiveFile,
}: {
  readonly schema: SchemaIdeInputSchema<A, Routes>;
  readonly workspace: VersionedWorkspaceState;
  readonly revision: number;
  readonly defaultFormat: SchemaIdeDocumentFormat;
  readonly activeFile?: string | null | undefined;
}): WorkspaceSnapshot {
  const activeFile: string | null =
    requestedActiveFile && workspace.files.some((file) => file.path === requestedActiveFile)
      ? requestedActiveFile
      : (workspace.files[0]?.path ?? null);
  const activeFormat = activeFile ? codecForPath(activeFile, defaultFormat).format : defaultFormat;
  const validation = validateSchemaIdeValue({
    schema,
    files: workspace.files,
    activeFile,
    activeFormat,
  });
  return {
    revision,
    files: workspace.files,
    reflection: createReflection({
      schema,
      files: workspace.files,
      activeFile,
      activeFormat,
      validation,
    }),
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

function toWorkspaceError(error: unknown): SchemaIdeWorkspaceError {
  if (error instanceof SchemaIdeWorkspaceError) return error;
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
