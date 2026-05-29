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
  createSchemaIdeArtifactRuntime,
  createVersionedWorkspace,
  type SchemaIdeDocumentFormat,
  type SourceFile,
} from "@schema-ide/core";
import { schemaIdeExamples } from "@schema-ide/examples";
import {
  SchemaIdeWorkspaceError,
  SchemaIdeWorkspaceRpcGroup,
  artifactChangeToWorkspaceChange,
  type ArtifactCapability,
  type ArtifactRef,
  type SchemaIdeWorkspaceService,
  type WorkspaceCapabilities,
  type WorkspaceChangeRequest,
  type WorkspaceEvent,
  type WorkspacePreviewRequest,
  type WorkspacePreviewResponse,
  type WorkspaceSnapshot,
} from "@schema-ide/protocol";
import { makeSchemaIdeWorkspaceRpcLayer } from "@schema-ide/server/workspace-rpc";
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

type DurableObjectStorageBinding = DurableObjectStorage | DurableObjectState["storage"];
type DurableObjectTransactionBinding = DurableObjectTransaction;

const metadataKey = "metadata";
const filePrefix = "file:";
const defaultTemplateId = "workflow-json";

export class SchemaIdeWorkspaceObject extends DurableObject {
  private handler: ((request: Request) => Promise<Response>) | null = null;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/internal/initialize") {
      return this.initializeWorkspace(await readInitializeRequest(request));
    }

    if (request.method === "GET" && url.pathname === "/internal/metadata") {
      return this.getMetadataResponse();
    }

    return this.getHandler()(request);
  }

  private getHandler(): (request: Request) => Promise<Response> {
    if (this.handler) return this.handler;

    const workspace = makeDurableObjectWorkspaceService(this.ctx.storage);
    const appLayer = RpcServer.layerHttp({
      group: SchemaIdeWorkspaceRpcGroup,
      path: "*",
      protocol: "http",
    }).pipe(
      Layer.provide([makeSchemaIdeWorkspaceRpcLayer(workspace), RpcSerialization.layerNdjson]),
      Layer.provide([Etag.layer, HttpServer.layerServices]),
    );
    const handler = HttpRouter.toWebHandler(appLayer).handler;
    this.handler = (request) => handler(request, undefined as never);
    return this.handler;
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
      await writeFilesRaw(transaction, template.files, []);
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
}

function makeDurableObjectWorkspaceService(
  storage: DurableObjectStorageBinding,
): SchemaIdeWorkspaceService {
  const capabilities = (metadata: HostedWorkspaceMetadata): WorkspaceCapabilities => ({
    mode: "remote",
    workspace: {
      id: metadata.workspaceId,
      title: metadata.title,
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

  const getSnapshot = readSnapshot(storage);
  const watchWorkspace = Stream.unwrap(
    Effect.gen(function* () {
      const metadata = yield* readMetadata(storage);
      const snapshot = yield* getSnapshot;
      return Stream.fromIterable<WorkspaceEvent>([
        { type: "capabilities", capabilities: capabilities(metadata) },
        { type: "snapshot", snapshot },
      ]);
    }),
  );

  return {
    getCapabilities: readMetadata(storage).pipe(Effect.map(capabilities)),
    getSnapshot,
    watchWorkspace,
    watchArtifactProject: watchWorkspace,
    applyChange: (change) =>
      Effect.tryPromise({
        try: async () => {
          const response = await storage.transaction(async (transaction) => {
            const before = await readFilesRaw(transaction);
            const metadata = await readMetadataRaw(transaction);
            const nextWorkspace = applyWorkspaceChange(createVersionedWorkspace(before), change, {
              actor: "user",
              label: workspaceChangeLabel(change),
            });
            const now = new Date().toISOString();
            const nextMetadata = {
              ...metadata,
              updatedAt: now,
              revision: metadata.revision + 1,
            };
            const changedPaths = changedPathsForChange(change, before);

            await writeFilesRaw(transaction, nextWorkspace.files, before);
            await transaction.put(metadataKey, nextMetadata);
            await transaction.put(`change:${nextMetadata.revision.toString().padStart(12, "0")}`, {
              revision: nextMetadata.revision,
              createdAt: now,
              actor: "user",
              label: workspaceChangeLabel(change),
              changedPaths,
            });

            return {
              revision: nextMetadata.revision,
              changedPaths,
            };
          });
          const snapshot = await Effect.runPromise(readSnapshot(storage));
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
        return yield* makePreviewResponse(metadata, request);
      }).pipe(Effect.mapError(toWorkspaceError)),
    listArtifactRefs: Effect.gen(function* () {
      const metadata = yield* readMetadata(storage);
      const files = yield* readFiles(storage);
      const runtime = createArtifactRuntime(metadata, files);
      const refs = yield* runtime.store.list.pipe(Effect.mapError(toWorkspaceError));
      const artifacts = [
        { _tag: "Workspace" as const, workspaceId: metadata.workspaceId },
        ...refs.filter(isProtocolArtifactRef),
      ];
      return { artifacts, count: artifacts.length };
    }).pipe(Effect.mapError(toWorkspaceError)),
    getArtifactCapabilities: (request) =>
      Effect.gen(function* () {
        const metadata = yield* readMetadata(storage);
        const files = yield* readFiles(storage);
        const runtime = createArtifactRuntime(metadata, files);
        const ref = yield* normalizeArtifactRef(runtime, request.ref, metadata.workspaceId);
        return {
          capabilities: runtime.capabilities(ref).map(protocolCapability),
        };
      }).pipe(Effect.mapError(toWorkspaceError)),
    readArtifactView: (request) =>
      Effect.gen(function* () {
        const metadata = yield* readMetadata(storage);
        const files = yield* readFiles(storage);
        const runtime = createArtifactRuntime(metadata, files);
        const ref = yield* normalizeArtifactRef(runtime, request.ref, metadata.workspaceId);
        const value = yield* runtime
          .view(ref, request.view)
          .pipe(Effect.mapError(toWorkspaceError));
        return { ref: request.ref, view: request.view, value };
      }),
    applyArtifactChange: (change) =>
      Effect.tryPromise({
        try: async () => {
          const workspaceChange = artifactChangeToWorkspaceChange(change);
          const response = await storage.transaction(async (transaction) => {
            const before = await readFilesRaw(transaction);
            const metadata = await readMetadataRaw(transaction);
            const nextWorkspace = applyWorkspaceChange(
              createVersionedWorkspace(before),
              workspaceChange,
              {
                actor: "user",
                label: workspaceChangeLabel(workspaceChange),
              },
            );
            const now = new Date().toISOString();
            const nextMetadata = {
              ...metadata,
              updatedAt: now,
              revision: metadata.revision + 1,
            };
            const changedPaths = changedPathsForChange(workspaceChange, before);

            await writeFilesRaw(transaction, nextWorkspace.files, before);
            await transaction.put(metadataKey, nextMetadata);
            await transaction.put(`change:${nextMetadata.revision.toString().padStart(12, "0")}`, {
              revision: nextMetadata.revision,
              createdAt: now,
              actor: "user",
              label: workspaceChangeLabel(workspaceChange),
              changedPaths,
            });

            return {
              revision: nextMetadata.revision,
              changedPaths,
            };
          });
          const snapshot = await Effect.runPromise(readSnapshot(storage));
          return {
            ...response,
            validationSummary: snapshot.reflection.validationSummary,
          };
        },
        catch: toWorkspaceError,
      }),
  };
}

function readSnapshot(storage: DurableObjectStorageBinding) {
  return Effect.gen(function* () {
    const metadata = yield* readMetadata(storage);
    const files = yield* readFiles(storage);
    return yield* makeSnapshot(metadata, files);
  }).pipe(Effect.mapError(toWorkspaceError));
}

function readFiles(
  storage: DurableObjectStorageBinding,
): Effect.Effect<readonly SourceFile[], SchemaIdeWorkspaceError> {
  return Effect.tryPromise({
    try: () => readFilesRaw(storage),
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

async function readFilesRaw(
  storage: DurableObjectStorageBinding | DurableObjectTransactionBinding,
): Promise<readonly SourceFile[]> {
  const entries = await storage.list<SourceFile>({ prefix: filePrefix });
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function writeFilesRaw(
  transaction: DurableObjectTransactionBinding,
  nextFiles: readonly SourceFile[],
  previousFiles: readonly SourceFile[],
): Promise<void> {
  const nextPaths = new Set(nextFiles.map((file) => file.path));
  const deletedKeys = previousFiles
    .filter((file) => !nextPaths.has(file.path))
    .map((file) => fileKey(file.path));

  if (deletedKeys.length) {
    await transaction.delete(deletedKeys);
  }

  for (const file of nextFiles) {
    assertSafeWorkspacePath(file.path);
    await transaction.put(fileKey(file.path), file);
  }
}

function makeSnapshot(
  metadata: HostedWorkspaceMetadata,
  files: readonly SourceFile[],
): Effect.Effect<WorkspaceSnapshot, SchemaIdeWorkspaceError> {
  return Effect.gen(function* () {
    const runtime = yield* Effect.try({
      try: () => createArtifactRuntime(metadata, files),
      catch: toWorkspaceError,
    });
    const reflection = yield* runtime.reflection.pipe(Effect.mapError(toWorkspaceError));
    return {
      revision: metadata.revision,
      files,
      reflection,
    };
  });
}

function makeSnapshotWithActiveFile(
  metadata: HostedWorkspaceMetadata,
  files: readonly SourceFile[],
  activeFile: string | null | undefined,
): Effect.Effect<WorkspaceSnapshot, SchemaIdeWorkspaceError> {
  return Effect.gen(function* () {
    const runtime = yield* Effect.try({
      try: () => createArtifactRuntime(metadata, files, activeFile),
      catch: toWorkspaceError,
    });
    const reflection = yield* runtime.reflection.pipe(Effect.mapError(toWorkspaceError));
    return {
      revision: metadata.revision,
      files,
      reflection,
    };
  });
}

function makePreviewResponse(
  metadata: HostedWorkspaceMetadata,
  request: WorkspacePreviewRequest,
): Effect.Effect<WorkspacePreviewResponse, SchemaIdeWorkspaceError> {
  const files = createVersionedWorkspace(request.files).files;
  const activeFile = request.activeFile
    ? (files.find((file) => file.path === request.activeFile)?.path ?? files[0]?.path ?? null)
    : (files[0]?.path ?? null);
  return makeSnapshotWithActiveFile(metadata, files, activeFile).pipe(
    Effect.map((snapshot) => ({
      reflection: snapshot.reflection,
    })),
  );
}

function createArtifactRuntime(
  metadata: HostedWorkspaceMetadata,
  files: readonly SourceFile[],
  activeFile?: string | null | undefined,
) {
  const template = findTemplate(metadata.templateId) ?? findTemplate(defaultTemplateId);
  if (!template) {
    throw new SchemaIdeWorkspaceError(
      `Workspace template is not available: ${metadata.templateId}`,
      "storage",
    );
  }

  const selectedActiveFile =
    activeFile && files.some((file) => file.path === activeFile)
      ? activeFile
      : (files[0]?.path ?? null);
  const activeFormat = selectedActiveFile
    ? codecForPath(selectedActiveFile, metadata.defaultFormat).format
    : metadata.defaultFormat;

  return createSchemaIdeArtifactRuntime({
    schema: template.schema,
    project: template.project,
    files,
    activeFile: selectedActiveFile,
    activeFormat,
    workspaceId: metadata.workspaceId,
  });
}

function normalizeArtifactRef(
  runtime: ReturnType<typeof createArtifactRuntime>,
  ref: ArtifactRef,
  workspaceId: string,
): Effect.Effect<ArtifactRef, SchemaIdeWorkspaceError> {
  if (ref._tag === "Workspace" && !ref.workspaceId) {
    return Effect.succeed({ _tag: "Workspace", workspaceId });
  }
  if (ref._tag !== "WorkspaceFile") return Effect.succeed(ref);

  return runtime.store.list.pipe(
    Effect.map((refs) => {
      const existing = refs.find(
        (candidate) => candidate._tag === "WorkspaceFile" && candidate.path === ref.path,
      );
      return {
        _tag: "WorkspaceFile" as const,
        path: ref.path,
        workspaceId:
          existing?._tag === "WorkspaceFile"
            ? (existing.workspaceId ?? ref.workspaceId ?? workspaceId)
            : (ref.workspaceId ?? workspaceId),
      };
    }),
    Effect.mapError(toWorkspaceError),
  );
}

function protocolCapability(capability: {
  readonly id: string;
  readonly type: string;
  readonly view: string;
  readonly annotations: unknown;
  readonly routeId?: string | undefined;
  readonly routePattern?: string | undefined;
}): ArtifactCapability {
  return {
    id: capability.id,
    type: capability.type,
    view: capability.view,
    annotations: capability.annotations,
    ...(capability.routeId ? { routeId: capability.routeId } : {}),
    ...(capability.routePattern ? { routePattern: capability.routePattern } : {}),
  };
}

function isProtocolArtifactRef(ref: {
  readonly _tag: string;
  readonly path?: string | undefined;
  readonly workspaceId?: string | undefined;
}): ref is ArtifactRef {
  return ref._tag === "Workspace" || (ref._tag === "WorkspaceFile" && typeof ref.path === "string");
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

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function fileKey(path: string): string {
  return `${filePrefix}${encodeURIComponent(path)}`;
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
