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
  createReflection,
  createVersionedWorkspace,
  validateSchemaIdeValue,
  type SchemaIdeDocumentFormat,
  type SourceFile,
} from "@schema-ide/core";
import { schemaIdeExamples } from "@schema-ide/examples";
import {
  SchemaIdeWorkspaceError,
  SchemaIdeWorkspaceRpcGroup,
  artifactChangeToWorkspaceChange,
  getArtifactCapabilitiesFromSnapshot,
  listArtifactRefsFromSnapshot,
  readArtifactViewFromSnapshot,
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

  return {
    getCapabilities: readMetadata(storage).pipe(Effect.map(capabilities)),
    getSnapshot,
    watchWorkspace: Stream.unwrap(
      Effect.gen(function* () {
        const metadata = yield* readMetadata(storage);
        const snapshot = yield* getSnapshot;
        return Stream.fromIterable<WorkspaceEvent>([
          { type: "capabilities", capabilities: capabilities(metadata) },
          { type: "snapshot", snapshot },
        ]);
      }),
    ),
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
        return makePreviewResponse(metadata, request);
      }).pipe(Effect.mapError(toWorkspaceError)),
    listArtifactRefs: Effect.gen(function* () {
      const metadata = yield* readMetadata(storage);
      const snapshot = yield* getSnapshot;
      return listArtifactRefsFromSnapshot(snapshot, metadata.workspaceId);
    }).pipe(Effect.mapError(toWorkspaceError)),
    getArtifactCapabilities: (request) =>
      getSnapshot.pipe(
        Effect.map((snapshot) =>
          getArtifactCapabilitiesFromSnapshot({ snapshot, ref: request.ref }),
        ),
        Effect.mapError(toWorkspaceError),
      ),
    readArtifactView: (request) =>
      getSnapshot.pipe(
        Effect.flatMap((snapshot) =>
          Effect.try({
            try: () => readArtifactViewFromSnapshot({ snapshot, ...request }),
            catch: toWorkspaceError,
          }),
        ),
      ),
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
  return Effect.tryPromise({
    try: async () => {
      const metadata = await readMetadataRaw(storage);
      const files = await readFilesRaw(storage);
      return makeSnapshot(metadata, files);
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
    revision: metadata.revision,
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
