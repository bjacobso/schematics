/// <reference path="./cloudflare-workers.d.ts" />

import {
  DurableObject,
  type DurableObjectState,
  type DurableObjectStorage,
  type DurableObjectTransaction,
} from "cloudflare:workers";
import {
  codecForPath,
  createSchemaIdeArtifactRuntime,
  type SchemaIdeDocumentFormat,
  type SourceFile,
} from "@schema-ide/core";
import {
  ArtifactRef as ArtifactRefFactory,
  createMemoryArtifactStore,
  createVersionedArtifactStore,
  type ArtifactRefDefinition,
  type ArtifactStore,
  type ArtifactStoreChange,
  type ArtifactStoreEntry,
} from "@schema-ide/artifacts";
import { schemaIdeExamples } from "@schema-ide/examples";
import {
  SchemaIdeArtifactProjectError,
  SchemaIdeArtifactProjectRpcGroup,
  artifactChangeToProjectChange,
  type ArtifactCapability,
  type ArtifactRef,
  type SchemaIdeArtifactProjectService,
  type ArtifactProjectCapabilities,
  type ArtifactProjectChangeRequest,
  type ArtifactProjectStateEvent,
  type ArtifactProjectPreviewRequest,
  type ArtifactProjectPreviewResponse,
  type ArtifactProjectStateSnapshot,
} from "@schema-ide/protocol";
import { makeSchemaIdeArtifactProjectRpcLayer } from "@schema-ide/server/artifact-project-rpc";
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
      group: SchemaIdeArtifactProjectRpcGroup,
      path: "*",
      protocol: "http",
    }).pipe(
      Layer.provide([
        makeSchemaIdeArtifactProjectRpcLayer(workspace),
        RpcSerialization.layerNdjson,
      ]),
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
): SchemaIdeArtifactProjectService {
  const capabilities = (metadata: HostedWorkspaceMetadata): ArtifactProjectCapabilities => {
    const projectMetadata = {
      id: metadata.workspaceId,
      title: metadata.title,
      readOnly: false,
    };
    return {
      mode: "remote",
      project: projectMetadata,
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
    };
  };

  const getSnapshot = readSnapshot(storage);
  const watchArtifactProjectState = Stream.unwrap(
    Effect.gen(function* () {
      const metadata = yield* readMetadata(storage);
      const snapshot = yield* getSnapshot;
      return Stream.fromIterable<ArtifactProjectStateEvent>([
        { type: "capabilities", capabilities: capabilities(metadata) },
        { type: "snapshot", snapshot },
      ]);
    }),
  );

  return {
    getCapabilities: readMetadata(storage).pipe(Effect.map(capabilities)),
    getSnapshot,
    watchArtifactProjectState,
    watchArtifactProject: watchArtifactProjectState,
    applyChange: (change) =>
      Effect.tryPromise({
        try: async () => {
          const response = await storage.transaction(async (transaction) => {
            const before = await readFilesRaw(transaction);
            const metadata = await readMetadataRaw(transaction);
            const nextFiles = await filesFromArtifactStoreChange(
              before,
              change,
              workspaceChangeLabel(change),
            );
            const now = new Date().toISOString();
            const nextMetadata = {
              ...metadata,
              updatedAt: now,
              revision: metadata.revision + 1,
            };
            const changedPaths = changedPathsForChange(change, before);

            await writeFilesRaw(transaction, nextFiles, before);
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
        { _tag: "Project" as const, projectId: metadata.workspaceId },
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
          const workspaceChange = artifactChangeToProjectChange(change);
          const response = await storage.transaction(async (transaction) => {
            const before = await readFilesRaw(transaction);
            const metadata = await readMetadataRaw(transaction);
            const nextFiles = await filesFromArtifactStoreChange(
              before,
              workspaceChange,
              workspaceChangeLabel(workspaceChange),
            );
            const now = new Date().toISOString();
            const nextMetadata = {
              ...metadata,
              updatedAt: now,
              revision: metadata.revision + 1,
            };
            const changedPaths = changedPathsForChange(workspaceChange, before);

            await writeFilesRaw(transaction, nextFiles, before);
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
): Effect.Effect<readonly SourceFile[], SchemaIdeArtifactProjectError> {
  return Effect.tryPromise({
    try: () => readFilesRaw(storage),
    catch: toWorkspaceError,
  });
}

function readMetadata(
  storage: DurableObjectStorageBinding,
): Effect.Effect<HostedWorkspaceMetadata, SchemaIdeArtifactProjectError> {
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
    throw new SchemaIdeArtifactProjectError("Workspace has not been initialized.", "not-found");
  }
  return metadata;
}

async function readFilesRaw(
  storage: DurableObjectStorageBinding | DurableObjectTransactionBinding,
): Promise<readonly SourceFile[]> {
  const entries = await storage.list<SourceFile>({ prefix: filePrefix });
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function filesFromArtifactStoreChange(
  before: readonly SourceFile[],
  change: ArtifactProjectChangeRequest,
  label: string,
): Promise<readonly SourceFile[]> {
  validateWorkspaceChangePaths(change);
  const store = createMemoryArtifactStore({ files: before });
  const versionedStore = createVersionedArtifactStore(store);
  await Effect.runPromise(
    Effect.gen(function* () {
      const refs = yield* store.list;
      const artifactChange = yield* workspaceChangeToArtifactStoreChange(store, refs, change);
      yield* versionedStore
        .apply(artifactChange, { actor: "user", label })
        .pipe(Effect.mapError(toWorkspaceError));
    }),
  );
  return Effect.runPromise(sourceFilesFromArtifactStore(store));
}

function validateWorkspaceChangePaths(change: ArtifactProjectChangeRequest): void {
  switch (change.type) {
    case "writeFile":
    case "createFile":
    case "deleteFile":
      assertSafeWorkspacePath(change.path);
      return;
    case "renameFile":
      assertSafeWorkspacePath(change.fromPath);
      assertSafeWorkspacePath(change.toPath);
      return;
    case "replaceFiles":
      for (const file of change.files) assertSafeWorkspacePath(file.path);
      return;
  }
}

function workspaceChangeToArtifactStoreChange(
  store: ArtifactStore,
  refs: readonly ArtifactRefDefinition[],
  change: ArtifactProjectChangeRequest,
): Effect.Effect<ArtifactStoreChange, SchemaIdeArtifactProjectError> {
  switch (change.type) {
    case "writeFile":
      return Effect.succeed({
        type: "write",
        ref: ArtifactRefFactory.projectFile(change.path),
        content: change.content,
      });
    case "createFile":
      return Effect.succeed({
        type: "create",
        ref: ArtifactRefFactory.projectFile(change.path),
        content: change.content,
      });
    case "deleteFile":
      return Effect.succeed({
        type: "delete",
        ref: ArtifactRefFactory.projectFile(change.path),
      });
    case "renameFile":
      return Effect.gen(function* () {
        const from = refs.find((ref) => ref._tag === "ProjectFile" && ref.path === change.fromPath);
        if (!from) {
          return yield* Effect.fail(
            new SchemaIdeArtifactProjectError(`File not found: ${change.fromPath}`, "not-found"),
          );
        }
        if (
          change.fromPath !== change.toPath &&
          refs.some((ref) => ref._tag === "ProjectFile" && ref.path === change.toPath)
        ) {
          return yield* Effect.fail(
            new SchemaIdeArtifactProjectError(
              `File already exists: ${change.toPath}`,
              "already-exists",
            ),
          );
        }
        const entries = yield* artifactStoreEntries(store, refs);
        return {
          type: "replace",
          entries: entries.map((entry) =>
            entry.ref === from
              ? { ...entry, ref: ArtifactRefFactory.projectFile(change.toPath) }
              : entry,
          ),
        } satisfies ArtifactStoreChange;
      });
    case "replaceFiles":
      return Effect.succeed({
        type: "replace",
        entries: sourceFilesToArtifactStoreEntries(change.files),
      });
  }
}

function sourceFilesToArtifactStoreEntries(
  files: readonly SourceFile[],
): readonly ArtifactStoreEntry[] {
  return files.map((file) => ({
    ref: ArtifactRefFactory.projectFile(file.path),
    content: file.content,
  }));
}

function artifactStoreEntries(
  store: ArtifactStore,
  refs: readonly ArtifactRefDefinition[],
): Effect.Effect<readonly ArtifactStoreEntry[], SchemaIdeArtifactProjectError> {
  return Effect.forEach(
    refs.filter((ref) => ref._tag === "ProjectFile"),
    (ref) =>
      store.read(ref).pipe(
        Effect.map((content) => ({ ref, content })),
        Effect.mapError(toWorkspaceError),
      ),
  );
}

function sourceFilesFromArtifactStore(
  store: ArtifactStore,
): Effect.Effect<readonly SourceFile[], SchemaIdeArtifactProjectError> {
  return store.list.pipe(
    Effect.flatMap((refs) =>
      Effect.forEach(
        refs.filter((ref) => ref._tag === "ProjectFile"),
        (ref) =>
          store.read(ref).pipe(
            Effect.map((content) => ({
              path: ref.path,
              content: typeof content === "string" ? content : bytesToBase64(content),
            })),
            Effect.mapError(toWorkspaceError),
          ),
      ),
    ),
    Effect.map((files) => files.sort((left, right) => left.path.localeCompare(right.path))),
    Effect.mapError(toWorkspaceError),
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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
): Effect.Effect<ArtifactProjectStateSnapshot, SchemaIdeArtifactProjectError> {
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
): Effect.Effect<ArtifactProjectStateSnapshot, SchemaIdeArtifactProjectError> {
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
  request: ArtifactProjectPreviewRequest,
): Effect.Effect<ArtifactProjectPreviewResponse, SchemaIdeArtifactProjectError> {
  const files = normalizeSourceFiles(request.files);
  const activeFile = request.activeFile
    ? (files.find((file) => file.path === request.activeFile)?.path ?? files[0]?.path ?? null)
    : (files[0]?.path ?? null);
  return makeSnapshotWithActiveFile(metadata, files, activeFile).pipe(
    Effect.map((snapshot) => ({
      reflection: snapshot.reflection,
    })),
  );
}

function normalizeSourceFiles(files: readonly SourceFile[]): readonly SourceFile[] {
  const byPath = new Map<string, SourceFile>();
  for (const file of files) {
    byPath.set(file.path, file);
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function createArtifactRuntime(
  metadata: HostedWorkspaceMetadata,
  files: readonly SourceFile[],
  activeFile?: string | null | undefined,
) {
  const template = findTemplate(metadata.templateId) ?? findTemplate(defaultTemplateId);
  if (!template) {
    throw new SchemaIdeArtifactProjectError(
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
    projectId: metadata.workspaceId,
  });
}

function normalizeArtifactRef(
  runtime: ReturnType<typeof createArtifactRuntime>,
  ref: ArtifactRef,
  workspaceId: string,
): Effect.Effect<ArtifactRef, SchemaIdeArtifactProjectError> {
  if (ref._tag === "Project" && !ref.projectId) {
    return Effect.succeed({ _tag: "Project", projectId: workspaceId });
  }
  if (ref._tag !== "ProjectFile") return Effect.succeed(ref);

  return runtime.store.list.pipe(
    Effect.map((refs) => {
      const existing = refs.find(
        (candidate) => candidate._tag === "ProjectFile" && candidate.path === ref.path,
      );
      return {
        _tag: "ProjectFile" as const,
        path: ref.path,
        projectId:
          existing?._tag === "ProjectFile"
            ? (existing.projectId ?? ref.projectId ?? workspaceId)
            : (ref.projectId ?? workspaceId),
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
  readonly projectId?: string | undefined;
}): ref is ArtifactRef {
  return ref._tag === "Project" || (ref._tag === "ProjectFile" && typeof ref.path === "string");
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
    throw new SchemaIdeArtifactProjectError(`Unsafe workspace path: ${path}`, "unsafe-path");
  }
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

function toWorkspaceError(error: unknown): SchemaIdeArtifactProjectError {
  if (error instanceof SchemaIdeArtifactProjectError) return error;
  return new SchemaIdeArtifactProjectError(
    error instanceof Error ? error.message : String(error),
    "storage",
  );
}
