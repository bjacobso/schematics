/// <reference path="./cloudflare-workers.d.ts" />

import {
  DurableObject,
  type DurableObjectState,
  type DurableObjectStorage,
  type DurableObjectTransaction,
} from "cloudflare:workers";
import {
  applyWorkspaceChange,
  codecForPath,
  compareWorkspaceFiles,
  createReflection,
  createVersionedWorkspace,
  mergeWorkspaceFiles,
  validateSchemaIdeValue,
  type SchemaIdeDocumentFormat,
  type SourceFile,
} from "@schema-ide/core";
import { schemaIdeExamples } from "@schema-ide/examples";
import {
  SchemaIdeWorkspaceBranchRpcGroup,
  SchemaIdeWorkspaceError,
  SchemaIdeWorkspaceRpcGroup,
  type ArchiveWorkspaceBranchResponse,
  type CompareWorkspaceBranchRequest,
  type CreateWorkspaceBranchRequest,
  type CreateWorkspaceBranchResponse,
  type DeleteWorkspaceBranchResponse,
  type MergeWorkspaceBranchRequest,
  type MergeWorkspaceBranchResponse,
  type SchemaIdeWorkspaceBranchService,
  type SchemaIdeWorkspaceService,
  type WorkspaceCapabilities,
  type WorkspaceBranchComparison,
  type WorkspaceBranchMetadata,
  type WorkspaceChangeRequest,
  type WorkspaceEvent,
  type WorkspaceMergeConflict,
  type WorkspacePreviewRequest,
  type WorkspacePreviewResponse,
  type WorkspaceSnapshot,
} from "@schema-ide/protocol";
import {
  makeSchemaIdeWorkspaceBranchRpcLayer,
  makeSchemaIdeWorkspaceRpcLayer,
} from "@schema-ide/server";
import { Effect, Layer, Stream } from "effect";
import { Etag, HttpRouter, HttpServer } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

export interface HostedWorkspaceMetadata {
  readonly workspaceId: string;
  readonly templateId: string;
  readonly title: string;
  readonly defaultFormat: SchemaIdeDocumentFormat;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
}

export interface InitializeWorkspaceRequest {
  readonly workspaceId: string;
  readonly templateId?: string | undefined;
}

interface HostedWorkspaceBranchMetadata extends WorkspaceBranchMetadata {
  readonly revision: number;
}

type DurableObjectStorageBinding = DurableObjectStorage | DurableObjectState["storage"];
type DurableObjectTransactionBinding = DurableObjectTransaction;

const metadataKey = "metadata";
const filePrefix = "file:";
const mainBranchId = "main";
const branchKeyPrefix = "branch:";
const defaultTemplateId = "workflow-json";

export class SchemaIdeWorkspaceObject extends DurableObject {
  private readonly workspaceHandlers = new Map<string, (request: Request) => Promise<Response>>();
  private branchHandler: ((request: Request) => Promise<Response>) | null = null;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/internal/initialize") {
      return this.initializeWorkspace(await readInitializeRequest(request));
    }

    if (request.method === "GET" && url.pathname === "/internal/metadata") {
      return this.getMetadataResponse();
    }

    if (url.pathname === "/internal/branches") {
      return this.handleBranchesRequest(request);
    }

    if (url.pathname === "/v1/workspace/branch-rpc") {
      return this.getBranchHandler()(request);
    }

    const branchRpcMatch = /^\/branches\/([^/]+)\/rpc$/.exec(url.pathname);
    if (branchRpcMatch) {
      return this.getWorkspaceHandler(decodeURIComponent(branchRpcMatch[1] ?? ""))(request);
    }

    return this.getWorkspaceHandler(mainBranchId)(request);
  }

  private getWorkspaceHandler(branchId: string): (request: Request) => Promise<Response> {
    const existing = this.workspaceHandlers.get(branchId);
    if (existing) return existing;

    const workspace = makeDurableObjectWorkspaceService(this.ctx.storage, branchId);
    const appLayer = RpcServer.layerHttp({
      group: SchemaIdeWorkspaceRpcGroup,
      path: "*",
      protocol: "http",
    }).pipe(
      Layer.provide([makeSchemaIdeWorkspaceRpcLayer(workspace), RpcSerialization.layerNdjson]),
      Layer.provide([Etag.layer, HttpServer.layerServices]),
    );
    const handler = HttpRouter.toWebHandler(appLayer).handler;
    const workspaceHandler = (request: Request) => handler(request, undefined as never);
    this.workspaceHandlers.set(branchId, workspaceHandler);
    return workspaceHandler;
  }

  private getBranchHandler(): (request: Request) => Promise<Response> {
    if (this.branchHandler) return this.branchHandler;

    const branches = makeDurableObjectBranchService(this.ctx.storage);
    const appLayer = RpcServer.layerHttp({
      group: SchemaIdeWorkspaceBranchRpcGroup,
      path: "*",
      protocol: "http",
    }).pipe(
      Layer.provide([makeSchemaIdeWorkspaceBranchRpcLayer(branches), RpcSerialization.layerNdjson]),
      Layer.provide([Etag.layer, HttpServer.layerServices]),
    );
    const handler = HttpRouter.toWebHandler(appLayer).handler;
    this.branchHandler = (request) => handler(request, undefined as never);
    return this.branchHandler;
  }

  private async initializeWorkspace(request: InitializeWorkspaceRequest): Promise<Response> {
    const existing = await this.ctx.storage.get<HostedWorkspaceMetadata>(metadataKey);
    if (existing) {
      return jsonResponse(toMetadataResponse(existing));
    }

    const template = findTemplate(request.templateId ?? defaultTemplateId);
    if (!template) {
      return jsonResponse({ error: "Unknown workspace template." }, 400);
    }

    const now = new Date().toISOString();
    const metadata: HostedWorkspaceMetadata = {
      workspaceId: request.workspaceId,
      templateId: template.id,
      title: template.name,
      defaultFormat: template.defaultFormat ?? "json",
      createdAt: now,
      updatedAt: now,
      revision: 0,
    };

    await this.ctx.storage.transaction(async (transaction) => {
      await transaction.put(metadataKey, metadata);
      const mainBranch = makeMainBranchMetadata(metadata);
      await transaction.put(branchMetadataKey(mainBranchId), mainBranch);
      await writeFilesRaw(transaction, template.files, [], mainBranchId);
    });

    return jsonResponse(toMetadataResponse(metadata), 201);
  }

  private async getMetadataResponse(): Promise<Response> {
    const metadata = await this.ctx.storage.get<HostedWorkspaceMetadata>(metadataKey);
    if (!metadata) {
      return jsonResponse({ error: "Workspace has not been initialized." }, 404);
    }
    return jsonResponse(toMetadataResponse(metadata));
  }

  private async handleBranchesRequest(request: Request): Promise<Response> {
    const branches = makeDurableObjectBranchService(this.ctx.storage);

    if (request.method === "GET") {
      return jsonResponse(await Effect.runPromise(branches.listBranches));
    }

    if (request.method === "POST") {
      const body = await readJsonObject(request);
      const response = await Effect.runPromise(
        branches.createBranch({
          fromBranchId: typeof body["fromBranchId"] === "string" ? body["fromBranchId"] : undefined,
          name: typeof body["name"] === "string" ? body["name"] : undefined,
          title: typeof body["title"] === "string" ? body["title"] : undefined,
          createdBy:
            body["createdBy"] === "user" ||
            body["createdBy"] === "agent" ||
            body["createdBy"] === "system"
              ? body["createdBy"]
              : undefined,
        }),
      );
      return jsonResponse(response, 201);
    }

    return jsonResponse({ error: "Method not allowed." }, 405);
  }
}

export function makeDurableObjectWorkspaceService(
  storage: DurableObjectStorageBinding,
  branchId = mainBranchId,
): SchemaIdeWorkspaceService {
  const capabilities = (
    metadata: HostedWorkspaceMetadata,
    branch: HostedWorkspaceBranchMetadata,
  ): WorkspaceCapabilities => ({
    mode: "remote",
    workspace: {
      id: branch.id === mainBranchId ? metadata.workspaceId : branch.id,
      title: branch.title ?? branch.name ?? metadata.title,
      readOnly: false,
    },
    agent: {
      enabled: true,
    },
    features: {
      watch: false,
      write: true,
      rename: true,
      delete: true,
      history: true,
      previews: true,
    },
  });

  const getSnapshot = readSnapshot(storage, branchId);

  return {
    getCapabilities: Effect.gen(function* () {
      const metadata = yield* readMetadata(storage);
      const branch = yield* readBranchMetadata(storage, branchId);
      return capabilities(metadata, branch);
    }),
    getSnapshot,
    watchWorkspace: Stream.unwrap(
      Effect.gen(function* () {
        const metadata = yield* readMetadata(storage);
        const branch = yield* readBranchMetadata(storage, branchId);
        const snapshot = yield* getSnapshot;
        return Stream.fromIterable<WorkspaceEvent>([
          { type: "capabilities", capabilities: capabilities(metadata, branch) },
          { type: "snapshot", snapshot },
        ]);
      }),
    ),
    applyChange: (change) =>
      Effect.tryPromise({
        try: async () => {
          const response = await storage.transaction(async (transaction) => {
            const before = await readFilesRaw(transaction, branchId);
            const metadata = await readMetadataRaw(transaction);
            const branch = await readBranchMetadataRaw(transaction, branchId);
            const nextWorkspace = applyWorkspaceChange(createVersionedWorkspace(before), change, {
              actor: "user",
              label: workspaceChangeLabel(change),
            });
            const now = new Date().toISOString();
            const nextRevision = branch.revision + 1;
            const nextBranch = {
              ...branch,
              updatedAt: Date.now(),
              revision: nextRevision,
              headRevisionId: `rev-${nextRevision}`,
            };
            const nextMetadata = {
              ...metadata,
              updatedAt: now,
              revision: branchId === mainBranchId ? nextRevision : metadata.revision,
            };
            const changedPaths = changedPathsForChange(change, before);

            await writeFilesRaw(transaction, nextWorkspace.files, before, branchId);
            await transaction.put(branchMetadataKey(branchId), nextBranch);
            if (branchId === mainBranchId) {
              await transaction.put(metadataKey, nextMetadata);
            }
            await transaction.put(branchChangeKey(branchId, nextRevision), {
              revision: nextRevision,
              createdAt: now,
              actor: "user",
              label: workspaceChangeLabel(change),
              changedPaths,
            });

            return {
              revision: nextRevision,
              changedPaths,
            };
          });
          const snapshot = await Effect.runPromise(readSnapshot(storage, branchId));
          return {
            ...response,
            validationSummary: snapshot.reflection.validationSummary,
          };
        },
        catch: toWorkspaceError,
      }),
    previewFiles: (request) =>
      Effect.gen(function* () {
        const metadata = yield* readMetadata(storage);
        return makePreviewResponse(metadata, request);
      }).pipe(Effect.mapError(toWorkspaceError)),
  };
}

export function makeDurableObjectBranchService(
  storage: DurableObjectStorageBinding,
): SchemaIdeWorkspaceBranchService {
  return {
    listBranches: Effect.tryPromise({
      try: async () => {
        await ensureMainBranchRaw(storage);
        const entries = await storage.list<HostedWorkspaceBranchMetadata>({
          prefix: branchKeyPrefix,
        });
        return [...entries.entries()]
          .filter(([key]) => key.endsWith(":metadata"))
          .map(([, metadata]) => toBranchMetadataResponse(metadata))
          .sort(compareBranchMetadata);
      },
      catch: toWorkspaceError,
    }),
    createBranch: (request: CreateWorkspaceBranchRequest) =>
      Effect.tryPromise({
        try: async (): Promise<CreateWorkspaceBranchResponse> => {
          const sourceBranchId = request.fromBranchId ?? mainBranchId;
          const source = await readBranchMetadataRaw(storage, sourceBranchId);
          const files = await readFilesRaw(storage, sourceBranchId);
          const branchId = await uniqueBranchId(storage);
          const now = Date.now();
          const branch: HostedWorkspaceBranchMetadata = {
            id: branchId,
            name: request.name ?? branchId,
            kind: "draft",
            baseBranchId: source.id,
            baseRevisionId: source.headRevisionId,
            headRevisionId: null,
            createdAt: now,
            updatedAt: now,
            createdBy: request.createdBy,
            title: request.title,
            revision: 0,
          };

          await storage.transaction(async (transaction) => {
            await transaction.put(branchMetadataKey(branchId), branch);
            await writeFilesRaw(transaction, files, [], branchId);
            await writeBaseFilesRaw(transaction, branchId, files);
          });

          return { branch: toBranchMetadataResponse(branch) };
        },
        catch: toWorkspaceError,
      }),
    getBranch: (request) =>
      Effect.tryPromise({
        try: async () =>
          toBranchMetadataResponse(await readBranchMetadataRaw(storage, request.branchId)),
        catch: toWorkspaceError,
      }),
    compareBranch: (request: CompareWorkspaceBranchRequest) =>
      Effect.tryPromise({
        try: () => compareBranchesRaw(storage, request.sourceBranchId, request.targetBranchId),
        catch: toWorkspaceError,
      }),
    mergeBranch: (request: MergeWorkspaceBranchRequest) =>
      Effect.tryPromise({
        try: () => mergeBranchRaw(storage, request),
        catch: toWorkspaceError,
      }),
    deleteBranch: (request) =>
      Effect.tryPromise({
        try: async (): Promise<DeleteWorkspaceBranchResponse> => {
          const branch = await readBranchMetadataRaw(storage, request.branchId);
          if (branch.kind === "main") {
            throw new SchemaIdeWorkspaceError(
              "Cannot delete the main workspace branch.",
              "storage",
            );
          }
          await storage.transaction((transaction) =>
            deleteBranchRaw(transaction, request.branchId),
          );
          return { branchId: request.branchId };
        },
        catch: toWorkspaceError,
      }),
    archiveBranch: (request) =>
      Effect.tryPromise({
        try: async (): Promise<ArchiveWorkspaceBranchResponse> => {
          const branch = await readBranchMetadataRaw(storage, request.branchId);
          if (branch.kind === "main") {
            throw new SchemaIdeWorkspaceError(
              "Cannot archive the main workspace branch.",
              "storage",
            );
          }
          const archived: HostedWorkspaceBranchMetadata = {
            ...branch,
            kind: "archived",
            updatedAt: Date.now(),
          };
          await storage.put(branchMetadataKey(request.branchId), archived);
          return { branch: toBranchMetadataResponse(archived) };
        },
        catch: toWorkspaceError,
      }),
  };
}

function readSnapshot(storage: DurableObjectStorageBinding, branchId = mainBranchId) {
  return Effect.tryPromise({
    try: async () => {
      const metadata = await readMetadataRaw(storage);
      const branch = await readBranchMetadataRaw(storage, branchId);
      const files = await readFilesRaw(storage, branchId);
      return makeSnapshot(metadata, files, branch.revision);
    },
    catch: toWorkspaceError,
  });
}

function readMetadata(
  storage: DurableObjectStorageBinding,
): Effect.Effect<HostedWorkspaceMetadata, SchemaIdeWorkspaceError> {
  return Effect.tryPromise({
    try: () => readMetadataRaw(storage),
    catch: toWorkspaceError,
  });
}

async function readMetadataRaw(
  storage: DurableObjectStorageBinding | DurableObjectTransactionBinding,
): Promise<HostedWorkspaceMetadata> {
  const metadata = await storage.get<HostedWorkspaceMetadata>(metadataKey);
  if (!metadata) {
    throw new SchemaIdeWorkspaceError("Workspace has not been initialized.", "not-found");
  }
  return metadata;
}

function readBranchMetadata(
  storage: DurableObjectStorageBinding,
  branchId: string,
): Effect.Effect<HostedWorkspaceBranchMetadata, SchemaIdeWorkspaceError> {
  return Effect.tryPromise({
    try: () => readBranchMetadataRaw(storage, branchId),
    catch: toWorkspaceError,
  });
}

async function readBranchMetadataRaw(
  storage: DurableObjectStorageBinding | DurableObjectTransactionBinding,
  branchId: string,
): Promise<HostedWorkspaceBranchMetadata> {
  await ensureMainBranchRaw(storage);
  const branch = await storage.get<HostedWorkspaceBranchMetadata>(branchMetadataKey(branchId));
  if (!branch) {
    throw new SchemaIdeWorkspaceError(`Workspace branch not found: ${branchId}`, "not-found");
  }
  return branch;
}

async function ensureMainBranchRaw(
  storage: DurableObjectStorageBinding | DurableObjectTransactionBinding,
): Promise<void> {
  const existing = await storage.get<HostedWorkspaceBranchMetadata>(
    branchMetadataKey(mainBranchId),
  );
  if (existing) return;

  const metadata = await readMetadataRaw(storage);
  await storage.put(branchMetadataKey(mainBranchId), makeMainBranchMetadata(metadata));
}

async function readFilesRaw(
  storage: DurableObjectStorageBinding | DurableObjectTransactionBinding,
  branchId = mainBranchId,
): Promise<readonly SourceFile[]> {
  const entries = await storage.list<SourceFile>({ prefix: branchFilePrefix(branchId) });
  const files = [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
  if (files.length || branchId !== mainBranchId) return files;

  const legacyEntries = await storage.list<SourceFile>({ prefix: filePrefix });
  return [...legacyEntries.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function writeFilesRaw(
  transaction: DurableObjectTransactionBinding,
  nextFiles: readonly SourceFile[],
  previousFiles: readonly SourceFile[],
  branchId = mainBranchId,
): Promise<void> {
  const prefix = branchFilePrefix(branchId);
  const nextPaths = new Set(nextFiles.map((file) => file.path));
  const deletedKeys = previousFiles
    .filter((file) => !nextPaths.has(file.path))
    .flatMap((file) =>
      branchId === mainBranchId
        ? [fileKey(file.path), prefixedFileKey(prefix, file.path)]
        : [prefixedFileKey(prefix, file.path)],
    );

  if (deletedKeys.length) {
    await transaction.delete(deletedKeys);
  }

  for (const file of nextFiles) {
    assertSafeWorkspacePath(file.path);
    await transaction.put(prefixedFileKey(prefix, file.path), file);
    if (branchId === mainBranchId) {
      await transaction.put(fileKey(file.path), file);
    }
  }
}

async function writeBaseFilesRaw(
  transaction: DurableObjectTransactionBinding,
  branchId: string,
  files: readonly SourceFile[],
): Promise<void> {
  const prefix = branchBaseFilePrefix(branchId);
  for (const file of files) {
    assertSafeWorkspacePath(file.path);
    await transaction.put(prefixedFileKey(prefix, file.path), file);
  }
}

async function readBaseFilesRaw(
  storage: DurableObjectStorageBinding | DurableObjectTransactionBinding,
  branchId: string,
): Promise<readonly SourceFile[]> {
  const entries = await storage.list<SourceFile>({ prefix: branchBaseFilePrefix(branchId) });
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function compareBranchesRaw(
  storage: DurableObjectStorageBinding,
  sourceBranchId: string,
  targetBranchId = mainBranchId,
): Promise<WorkspaceBranchComparison> {
  const metadata = await readMetadataRaw(storage);
  const source = await readBranchMetadataRaw(storage, sourceBranchId);
  const target = await readBranchMetadataRaw(storage, targetBranchId);
  const sourceFiles = await readFilesRaw(storage, sourceBranchId);
  const targetFiles = await readFilesRaw(storage, targetBranchId);
  const storedBaseFiles = await readBaseFilesRaw(storage, sourceBranchId);
  const baseFiles = storedBaseFiles.length ? storedBaseFiles : targetFiles;
  const merge = mergeWorkspaceFiles({ baseFiles, targetFiles, sourceFiles });
  const validationSummary = makeSnapshot(metadata, sourceFiles, source.revision).reflection
    .validationSummary;

  return {
    baseRevisionId: source.baseRevisionId,
    sourceBranchId: source.id,
    targetBranchId: target.id,
    files: compareWorkspaceFiles(baseFiles, sourceFiles),
    validationSummary,
    mergeable: merge.status === "merged",
    conflicts: merge.status === "conflicts" ? merge.conflicts : [],
  };
}

async function mergeBranchRaw(
  storage: DurableObjectStorageBinding,
  request: MergeWorkspaceBranchRequest,
): Promise<MergeWorkspaceBranchResponse> {
  const sourceBranchId = request.sourceBranchId;
  const targetBranchId = request.targetBranchId ?? mainBranchId;
  const strategy = request.strategy ?? "three-way";
  const comparison = await compareBranchesRaw(storage, sourceBranchId, targetBranchId);
  if (strategy === "three-way" && comparison.conflicts.length) {
    return {
      status: "conflicts",
      conflicts: comparison.conflicts,
      comparison,
    };
  }

  return storage.transaction(async (transaction) => {
    const metadata = await readMetadataRaw(transaction);
    const source = await readBranchMetadataRaw(transaction, sourceBranchId);
    const target = await readBranchMetadataRaw(transaction, targetBranchId);
    const sourceFiles = await readFilesRaw(transaction, sourceBranchId);
    const targetFiles = await readFilesRaw(transaction, targetBranchId);
    const storedBaseFiles = await readBaseFilesRaw(transaction, sourceBranchId);
    const baseFiles = storedBaseFiles.length ? storedBaseFiles : targetFiles;
    const merge = mergeWorkspaceFiles({ baseFiles, targetFiles, sourceFiles, strategy });

    if (merge.status === "conflicts") {
      const conflicts = merge.conflicts as readonly WorkspaceMergeConflict[];
      return {
        status: "conflicts",
        conflicts,
        comparison: { ...comparison, mergeable: false, conflicts },
      };
    }

    if (
      request.expectedTargetRevisionId !== undefined &&
      request.expectedTargetRevisionId !== target.headRevisionId
    ) {
      throw new SchemaIdeWorkspaceError("Target branch revision did not match.", "storage");
    }

    const now = Date.now();
    const nextRevision = target.revision + 1;
    const nextTarget: HostedWorkspaceBranchMetadata = {
      ...target,
      updatedAt: now,
      revision: nextRevision,
      headRevisionId: `rev-${nextRevision}`,
    };

    await writeFilesRaw(transaction, merge.files, targetFiles, targetBranchId);
    await transaction.put(branchMetadataKey(targetBranchId), nextTarget);
    await transaction.put(branchChangeKey(targetBranchId, nextRevision), {
      revision: nextRevision,
      createdAt: new Date(now).toISOString(),
      actor: "user",
      label: `Merge ${source.name}`,
      changedPaths: comparison.files.map(diffPath),
    });

    if (targetBranchId === mainBranchId) {
      await transaction.put(metadataKey, {
        ...metadata,
        updatedAt: new Date(now).toISOString(),
        revision: nextRevision,
      });
    }

    if (request.deleteSource && source.kind !== "main") {
      await deleteBranchRaw(transaction, sourceBranchId);
    }

    return {
      status: "merged",
      targetBranch: toBranchMetadataResponse(nextTarget),
    };
  });
}

async function deleteBranchRaw(
  storage: DurableObjectTransactionBinding,
  branchId: string,
): Promise<void> {
  await storage.delete(branchMetadataKey(branchId));
  await deleteByPrefix(storage, branchFilePrefix(branchId));
  await deleteByPrefix(storage, branchBaseFilePrefix(branchId));
  await deleteByPrefix(storage, branchChangePrefix(branchId));
}

async function deleteByPrefix(
  storage: DurableObjectTransactionBinding,
  prefix: string,
): Promise<void> {
  const entries = await storage.list({ prefix });
  const keys = [...entries.keys()];
  if (keys.length) await storage.delete(keys);
}

function makeSnapshot(
  metadata: HostedWorkspaceMetadata,
  files: readonly SourceFile[],
  revision = metadata.revision,
): WorkspaceSnapshot {
  const template = findTemplate(metadata.templateId) ?? findTemplate(defaultTemplateId);
  if (!template) {
    throw new SchemaIdeWorkspaceError(
      `Workspace template is not available: ${metadata.templateId}`,
      "storage",
    );
  }

  const activeFile = files[0]?.path ?? null;
  const activeFormat = activeFile
    ? codecForPath(activeFile, metadata.defaultFormat).format
    : metadata.defaultFormat;
  const validation = validateSchemaIdeValue({
    schema: template.schema,
    files,
    activeFile,
    activeFormat,
  });

  return {
    revision,
    files,
    reflection: createReflection({
      schema: template.schema,
      files,
      activeFile,
      activeFormat,
      validation,
    }),
  };
}

function makePreviewResponse(
  metadata: HostedWorkspaceMetadata,
  request: WorkspacePreviewRequest,
): WorkspacePreviewResponse {
  const snapshot = makeSnapshot(metadata, createVersionedWorkspace(request.files).files);
  if (!request.activeFile) return { reflection: snapshot.reflection };

  const template = findTemplate(metadata.templateId) ?? findTemplate(defaultTemplateId);
  if (!template) return { reflection: snapshot.reflection };
  const activeFile = request.files.some((file) => file.path === request.activeFile)
    ? request.activeFile
    : (request.files[0]?.path ?? null);
  const activeFormat = activeFile
    ? codecForPath(activeFile, metadata.defaultFormat).format
    : metadata.defaultFormat;
  const validation = validateSchemaIdeValue({
    schema: template.schema,
    files: request.files,
    activeFile,
    activeFormat,
  });

  return {
    reflection: createReflection({
      schema: template.schema,
      files: request.files,
      activeFile,
      activeFormat,
      validation,
    }),
  };
}

async function readInitializeRequest(request: Request): Promise<InitializeWorkspaceRequest> {
  try {
    const json = await request.json();
    if (typeof json !== "object" || json === null) return { workspaceId: "" };
    const record = json as Record<string, unknown>;
    const templateId = record["templateId"];
    return typeof templateId === "string"
      ? { workspaceId: String(record["workspaceId"] ?? ""), templateId }
      : { workspaceId: String(record["workspaceId"] ?? "") };
  } catch {
    return { workspaceId: "" };
  }
}

function findTemplate(templateId: string) {
  return schemaIdeExamples.find((template) => template.id === templateId);
}

function toMetadataResponse(metadata: HostedWorkspaceMetadata) {
  return {
    workspaceId: metadata.workspaceId,
    templateId: metadata.templateId,
    title: metadata.title,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    revision: metadata.revision,
  };
}

function toBranchMetadataResponse(
  metadata: HostedWorkspaceBranchMetadata,
): WorkspaceBranchMetadata {
  return {
    id: metadata.id,
    name: metadata.name,
    kind: metadata.kind,
    baseBranchId: metadata.baseBranchId,
    baseRevisionId: metadata.baseRevisionId,
    headRevisionId: metadata.headRevisionId,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    createdBy: metadata.createdBy,
    title: metadata.title,
  };
}

function makeMainBranchMetadata(metadata: HostedWorkspaceMetadata): HostedWorkspaceBranchMetadata {
  const createdAt = Date.parse(metadata.createdAt);
  const updatedAt = Date.parse(metadata.updatedAt);
  return {
    id: mainBranchId,
    name: mainBranchId,
    kind: "main",
    baseBranchId: null,
    baseRevisionId: null,
    headRevisionId: metadata.revision > 0 ? `rev-${metadata.revision}` : null,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    title: metadata.title,
    revision: metadata.revision,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function fileKey(path: string): string {
  return prefixedFileKey(filePrefix, path);
}

function prefixedFileKey(prefix: string, path: string): string {
  return `${prefix}${encodeURIComponent(path)}`;
}

function branchMetadataKey(branchId: string): string {
  return `${branchKeyPrefix}${branchId}:metadata`;
}

function branchFilePrefix(branchId: string): string {
  return `${branchKeyPrefix}${branchId}:file:`;
}

function branchBaseFilePrefix(branchId: string): string {
  return `${branchKeyPrefix}${branchId}:base-file:`;
}

function branchChangePrefix(branchId: string): string {
  return `${branchKeyPrefix}${branchId}:change:`;
}

function branchChangeKey(branchId: string, revision: number): string {
  return `${branchChangePrefix(branchId)}${revision.toString().padStart(12, "0")}`;
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const json = await request.json();
    return typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function uniqueBranchId(storage: DurableObjectStorageBinding): Promise<string> {
  for (;;) {
    const candidate = `branch-${crypto.randomUUID()}`;
    if (!(await storage.get(branchMetadataKey(candidate)))) return candidate;
  }
}

function compareBranchMetadata(left: WorkspaceBranchMetadata, right: WorkspaceBranchMetadata) {
  if (left.kind === "main" && right.kind !== "main") return -1;
  if (left.kind !== "main" && right.kind === "main") return 1;
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

function diffPath(diff: ReturnType<typeof compareWorkspaceFiles>[number]): string {
  return diff.type === "renamed" ? diff.toPath : diff.path;
}

function assertSafeWorkspacePath(path: string): void {
  const normalized = path.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized === "." ||
    normalized === ".." ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new SchemaIdeWorkspaceError(`Unsafe workspace path: ${path}`, "unsafe-path");
  }
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
