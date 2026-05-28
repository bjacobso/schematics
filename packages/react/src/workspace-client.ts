import {
  applyWorkspaceChange,
  compareWorkspaceBranches,
  createReflection,
  createVersionedWorkspace,
  createWorkspaceBranch,
  mergeWorkspaceBranch,
  type SchemaIdeDocumentFormat,
  type SchemaIdeInputSchema,
  type SourceFile,
  type VersionedWorkspaceState,
  type WorkspaceBranchComparison,
  type WorkspaceBranchMergeStrategy,
  type WorkspaceBranchMetadata,
  type WorkspaceBranchState,
  type WorkspaceFileDiff,
  type WorkspaceMergeConflict,
  type WorkspaceRouteMap,
} from "@schema-ide/core";
import {
  SchemaIdeWorkspaceBranchRpcGroup,
  SchemaIdeWorkspaceError,
  SchemaIdeWorkspaceRpcGroup,
  workspaceRpcErrorToError,
  type ArchiveWorkspaceBranchRequest,
  type ArchiveWorkspaceBranchResponse,
  type CompareWorkspaceBranchRequest,
  type CreateWorkspaceBranchRequest,
  type CreateWorkspaceBranchResponse,
  type DeleteWorkspaceBranchRequest,
  type DeleteWorkspaceBranchResponse,
  type GetWorkspaceBranchRequest,
  type MergeWorkspaceBranchRequest,
  type MergeWorkspaceBranchResponse,
  type SchemaIdeWorkspaceBranchService,
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

export interface CreateMemoryWorkspaceBranchRepositoryOptions<
  A = unknown,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
> extends CreateMemoryWorkspaceClientOptions<A, Routes> {
  readonly mainBranchId?: string | undefined;
}

export interface MemoryWorkspaceCreateBranchRequest {
  readonly fromBranchId?: string | undefined;
  readonly name?: string | undefined;
  readonly title?: string | undefined;
  readonly createdBy?: "user" | "agent" | "system" | undefined;
}

export interface MemoryWorkspaceCreateBranchResponse {
  readonly branch: WorkspaceBranchMetadata;
}

export interface MemoryWorkspaceCompareBranchRequest {
  readonly sourceBranchId: string;
  readonly targetBranchId?: string | undefined;
}

export interface MemoryWorkspaceMergeBranchRequest extends MemoryWorkspaceCompareBranchRequest {
  readonly deleteSource?: boolean | undefined;
  readonly strategy?: WorkspaceBranchMergeStrategy | undefined;
}

export type MemoryWorkspaceMergeBranchResponse =
  | {
      readonly status: "merged";
      readonly targetBranch: WorkspaceBranchMetadata;
      readonly files: readonly SourceFile[];
      readonly diff: readonly WorkspaceFileDiff[];
    }
  | {
      readonly status: "conflicts";
      readonly conflicts: readonly WorkspaceMergeConflict[];
      readonly comparison: WorkspaceBranchComparison;
    };

export interface MemoryWorkspaceBranchRepository {
  readonly listBranches: Effect.Effect<readonly WorkspaceBranchMetadata[]>;
  readonly getBranch: (
    branchId: string,
  ) => Effect.Effect<WorkspaceBranchMetadata, SchemaIdeWorkspaceError>;
  readonly createBranch: (
    request?: MemoryWorkspaceCreateBranchRequest,
  ) => Effect.Effect<MemoryWorkspaceCreateBranchResponse, SchemaIdeWorkspaceError>;
  readonly compareBranch: (
    request: MemoryWorkspaceCompareBranchRequest,
  ) => Effect.Effect<WorkspaceBranchComparison, SchemaIdeWorkspaceError>;
  readonly mergeBranch: (
    request: MemoryWorkspaceMergeBranchRequest,
  ) => Effect.Effect<MemoryWorkspaceMergeBranchResponse, SchemaIdeWorkspaceError>;
  readonly deleteBranch: (branchId: string) => Effect.Effect<void, SchemaIdeWorkspaceError>;
  readonly archiveBranch: (
    branchId: string,
  ) => Effect.Effect<WorkspaceBranchMetadata, SchemaIdeWorkspaceError>;
  readonly getWorkspaceClient: (branchId?: string | undefined) => SchemaIdeWorkspaceService;
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

export function createMemoryWorkspaceBranchRepository<
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
  mainBranchId = "main",
}: CreateMemoryWorkspaceBranchRepositoryOptions<A, Routes>): MemoryWorkspaceBranchRepository {
  const branches = new Map<string, WorkspaceBranchState>();
  const baseFilesByBranch = new Map<string, readonly SourceFile[]>();
  const subscribersByBranch = new Map<string, Set<(event: WorkspaceEvent) => void>>();
  const main = createWorkspaceBranch({
    id: mainBranchId,
    name: mainBranchId,
    kind: "main",
    files: initialMemoryFiles({ defaultFormat, initialFiles, initialValue, value }),
    title,
  });
  branches.set(main.metadata.id, main);

  const getBranchState = (branchId: string): WorkspaceBranchState => {
    const branch = branches.get(branchId);
    if (!branch) {
      throw new SchemaIdeWorkspaceError(`Workspace branch not found: ${branchId}`, "not-found");
    }
    return branch;
  };

  const getBaseFiles = (sourceBranch: WorkspaceBranchState, targetBranch: WorkspaceBranchState) =>
    baseFilesByBranch.get(sourceBranch.metadata.id) ?? targetBranch.workspace.files;

  const publish = (branchId: string) => {
    const subscribers = subscribersByBranch.get(branchId);
    if (!subscribers?.size) return;
    const event: WorkspaceEvent = { type: "snapshot", snapshot: snapshotFor(branchId) };
    for (const subscriber of subscribers) subscriber(event);
  };

  const capabilities = (branch: WorkspaceBranchState): WorkspaceCapabilities => ({
    mode: "memory",
    workspace: {
      id: branch.metadata.id,
      title: branch.metadata.title ?? branch.metadata.name,
      readOnly,
    },
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
  });

  const snapshotFor = (branchId: string): WorkspaceSnapshot => {
    const branch = getBranchState(branchId);
    return makeMemorySnapshot({
      schema,
      workspace: branch.workspace,
      revision: branch.workspace.revisionSequence,
      defaultFormat,
    });
  };

  return {
    listBranches: Effect.sync(() =>
      [...branches.values()].map((branch) => branch.metadata).sort(compareBranchMetadata),
    ),
    getBranch: (branchId) =>
      Effect.try({
        try: () => getBranchState(branchId).metadata,
        catch: toWorkspaceError,
      }),
    createBranch: (request = {}) =>
      Effect.try({
        try: () => {
          const source = getBranchState(request.fromBranchId ?? mainBranchId);
          const branch = createWorkspaceBranch({
            id: uniqueBranchId(branches),
            name: request.name,
            sourceBranch: source,
            createdBy: request.createdBy,
            title: request.title,
          });
          branches.set(branch.metadata.id, branch);
          baseFilesByBranch.set(branch.metadata.id, source.workspace.files);
          return { branch: branch.metadata };
        },
        catch: toWorkspaceError,
      }),
    compareBranch: (request) =>
      Effect.try({
        try: () => {
          const source = getBranchState(request.sourceBranchId);
          const target = getBranchState(request.targetBranchId ?? mainBranchId);
          return compareWorkspaceBranches({
            sourceBranch: source,
            targetBranch: target,
            baseFiles: getBaseFiles(source, target),
            validationSummary: snapshotFor(source.metadata.id).reflection.validationSummary,
          });
        },
        catch: toWorkspaceError,
      }),
    mergeBranch: (request) =>
      Effect.try({
        try: () => {
          const source = getBranchState(request.sourceBranchId);
          const target = getBranchState(request.targetBranchId ?? mainBranchId);
          const comparison = compareWorkspaceBranches({
            sourceBranch: source,
            targetBranch: target,
            baseFiles: getBaseFiles(source, target),
            validationSummary: snapshotFor(source.metadata.id).reflection.validationSummary,
          });
          const result = mergeWorkspaceBranch({
            sourceBranch: source,
            targetBranch: target,
            baseFiles: getBaseFiles(source, target),
            validationSummary: comparison.validationSummary,
            strategy: request.strategy,
            metadata: {
              actor: "user",
              label: `Merge ${source.metadata.name}`,
            },
          });

          if (result.status === "conflicts") {
            return {
              status: "conflicts",
              conflicts: result.conflicts,
              comparison: result.comparison,
            };
          }

          branches.set(result.targetBranch.metadata.id, result.targetBranch);
          publish(result.targetBranch.metadata.id);
          if (request.deleteSource && source.metadata.kind !== "main") {
            branches.delete(source.metadata.id);
            baseFilesByBranch.delete(source.metadata.id);
            subscribersByBranch.delete(source.metadata.id);
          }
          return {
            status: "merged",
            targetBranch: result.targetBranch.metadata,
            files: result.files,
            diff: comparison.files,
          };
        },
        catch: toWorkspaceError,
      }),
    deleteBranch: (branchId) =>
      Effect.try({
        try: () => {
          const branch = getBranchState(branchId);
          if (branch.metadata.kind === "main") {
            throw new SchemaIdeWorkspaceError(
              "Cannot delete the main workspace branch.",
              "storage",
            );
          }
          branches.delete(branchId);
          baseFilesByBranch.delete(branchId);
          subscribersByBranch.delete(branchId);
        },
        catch: toWorkspaceError,
      }),
    archiveBranch: (branchId) =>
      Effect.try({
        try: () => {
          const branch = getBranchState(branchId);
          if (branch.metadata.kind === "main") {
            throw new SchemaIdeWorkspaceError(
              "Cannot archive the main workspace branch.",
              "storage",
            );
          }
          const archived: WorkspaceBranchState = {
            ...branch,
            metadata: {
              ...branch.metadata,
              kind: "archived",
              updatedAt: Date.now(),
            },
          };
          branches.set(branchId, archived);
          return archived.metadata;
        },
        catch: toWorkspaceError,
      }),
    getWorkspaceClient: (branchId = mainBranchId) => ({
      getCapabilities: Effect.try({
        try: () => capabilities(getBranchState(branchId)),
        catch: toWorkspaceError,
      }),
      getSnapshot: Effect.try({
        try: () => snapshotFor(branchId),
        catch: toWorkspaceError,
      }),
      watchWorkspace: Stream.callback<WorkspaceEvent, SchemaIdeWorkspaceError>((queue) =>
        Effect.acquireRelease(
          Effect.try({
            try: () => {
              const branch = getBranchState(branchId);
              let subscribers = subscribersByBranch.get(branchId);
              if (!subscribers) {
                subscribers = new Set();
                subscribersByBranch.set(branchId, subscribers);
              }
              const subscriber = (event: WorkspaceEvent) => Queue.offerUnsafe(queue, event);
              subscribers.add(subscriber);
              Queue.offerUnsafe(queue, {
                type: "capabilities",
                capabilities: capabilities(branch),
              });
              Queue.offerUnsafe(queue, { type: "snapshot", snapshot: snapshotFor(branchId) });
              return subscriber;
            },
            catch: toWorkspaceError,
          }),
          (subscriber) =>
            Effect.sync(() => {
              subscribersByBranch.get(branchId)?.delete(subscriber);
            }),
        ),
      ),
      applyChange: (change) =>
        Effect.try({
          try: () => {
            if (readOnly) {
              throw new SchemaIdeWorkspaceError("Workspace is read-only.", "read-only");
            }
            const branch = getBranchState(branchId);
            const before = branch.workspace.files;
            const workspace = applyWorkspaceChange(branch.workspace, change, {
              actor: "user",
              label: workspaceChangeLabel(change),
            });
            const nextBranch: WorkspaceBranchState = {
              metadata: {
                ...branch.metadata,
                headRevisionId: workspace.revisions[workspace.cursor]?.id ?? null,
                updatedAt: Date.now(),
              },
              workspace,
            };
            branches.set(branchId, nextBranch);
            publish(branchId);
            return {
              revision: workspace.revisionSequence,
              changedPaths: changedPathsForChange(change, before),
              validationSummary: snapshotFor(branchId).reflection.validationSummary,
            };
          },
          catch: toWorkspaceError,
        }),
      previewFiles: (request) =>
        Effect.try({
          try: () => ({
            reflection: makeMemorySnapshot({
              schema,
              workspace: createVersionedWorkspace(request.files),
              revision: snapshotFor(branchId).revision,
              defaultFormat,
              activeFile: request.activeFile,
            }).reflection,
          }),
          catch: toWorkspaceError,
        }),
    }),
  };
}

export function createMemoryWorkspaceBranchService(
  repository: MemoryWorkspaceBranchRepository,
): SchemaIdeWorkspaceBranchService {
  return {
    listBranches: repository.listBranches,
    createBranch: (request: CreateWorkspaceBranchRequest) =>
      repository.createBranch(request).pipe(
        Effect.map(
          (response): CreateWorkspaceBranchResponse => ({
            branch: response.branch,
          }),
        ),
      ),
    getBranch: (request: GetWorkspaceBranchRequest) => repository.getBranch(request.branchId),
    compareBranch: (request: CompareWorkspaceBranchRequest) => repository.compareBranch(request),
    mergeBranch: (request: MergeWorkspaceBranchRequest) =>
      repository.mergeBranch(request).pipe(
        Effect.map((response): MergeWorkspaceBranchResponse => {
          if (response.status === "conflicts") {
            return {
              status: "conflicts",
              conflicts: response.conflicts,
              comparison: response.comparison,
            };
          }
          return {
            status: "merged",
            targetBranch: response.targetBranch,
          };
        }),
      ),
    deleteBranch: (request: DeleteWorkspaceBranchRequest) =>
      repository.deleteBranch(request.branchId).pipe(
        Effect.as({
          branchId: request.branchId,
        } satisfies DeleteWorkspaceBranchResponse),
      ),
    archiveBranch: (request: ArchiveWorkspaceBranchRequest) =>
      repository.archiveBranch(request.branchId).pipe(
        Effect.map(
          (branch): ArchiveWorkspaceBranchResponse => ({
            branch,
          }),
        ),
      ),
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

export function createRpcWorkspaceBranchClient(
  baseUrl = "",
  rpcPath = "/v1/workspace/branch-rpc",
): SchemaIdeWorkspaceBranchService {
  const url = `${baseUrl.replace(/\/$/, "")}${rpcPath.startsWith("/") ? rpcPath : `/${rpcPath}`}`;
  const makeClient = RpcClient.make(SchemaIdeWorkspaceBranchRpcGroup).pipe(
    Effect.provide(RpcClient.layerProtocolHttp({ url })),
    Effect.provide(RpcSerialization.layerNdjson),
    Effect.provide(FetchHttpClient.layer),
  );

  return {
    listBranches: Effect.scoped(
      Effect.flatMap(makeClient, (client) => client.ListBranches(undefined)),
    ).pipe(Effect.mapError(toRpcWorkspaceError)),
    createBranch: (request) =>
      Effect.scoped(Effect.flatMap(makeClient, (client) => client.CreateBranch(request))).pipe(
        Effect.mapError(toRpcWorkspaceError),
      ),
    getBranch: (request) =>
      Effect.scoped(Effect.flatMap(makeClient, (client) => client.GetBranch(request))).pipe(
        Effect.mapError(toRpcWorkspaceError),
      ),
    compareBranch: (request) =>
      Effect.scoped(Effect.flatMap(makeClient, (client) => client.CompareBranch(request))).pipe(
        Effect.mapError(toRpcWorkspaceError),
      ),
    mergeBranch: (request) =>
      Effect.scoped(Effect.flatMap(makeClient, (client) => client.MergeBranch(request))).pipe(
        Effect.mapError(toRpcWorkspaceError),
      ),
    deleteBranch: (request) =>
      Effect.scoped(Effect.flatMap(makeClient, (client) => client.DeleteBranch(request))).pipe(
        Effect.mapError(toRpcWorkspaceError),
      ),
    archiveBranch: (request) =>
      Effect.scoped(Effect.flatMap(makeClient, (client) => client.ArchiveBranch(request))).pipe(
        Effect.mapError(toRpcWorkspaceError),
      ),
  };
}

function initialMemoryFiles<A>({
  defaultFormat,
  initialFiles,
  initialValue,
  value,
}: {
  readonly defaultFormat: SchemaIdeDocumentFormat;
  readonly initialFiles?: readonly SourceFile[] | undefined;
  readonly initialValue?: A | undefined;
  readonly value?: A | undefined;
}): readonly SourceFile[] {
  return initialFiles?.length
    ? initialFiles
    : [
        {
          path: `document.${defaultFormat === "yaml" ? "yaml" : "json"}`,
          content: stringifyDocument(value ?? initialValue ?? {}, defaultFormat),
        },
      ];
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

function uniqueBranchId(branches: ReadonlyMap<string, WorkspaceBranchState>): string {
  for (;;) {
    const candidate = `branch-${randomId()}`;
    if (!branches.has(candidate)) return candidate;
  }
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

function compareBranchMetadata(
  left: WorkspaceBranchMetadata,
  right: WorkspaceBranchMetadata,
): number {
  if (left.kind === "main" && right.kind !== "main") return -1;
  if (left.kind !== "main" && right.kind === "main") return 1;
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}
