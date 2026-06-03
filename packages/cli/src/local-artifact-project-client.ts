import { NodeFileSystem, NodePath } from "@effect/platform-node";
import {
  createSchemaIdeArtifactRuntime,
  formatForPath,
  type SchemaIdeReflection,
  type SourceFile,
} from "@schema-ide/core";
import {
  SchemaIdeArtifactProjectError,
  artifactChangeToProjectChange,
  type ArtifactRef,
  type SchemaIdeArtifactProjectService,
  type ArtifactProjectCapabilities,
  type ArtifactProjectChangeRequest,
  type ArtifactProjectEvent,
  type ArtifactProjectSnapshot,
  type SchemaIdeValidationSummaryDto,
} from "@schema-ide/protocol";
import {
  ArtifactRef as ArtifactRefFactory,
  createMemoryArtifactStore,
  createVersionedArtifactStore,
  loadedEntry,
  type ArtifactRefDefinition,
  type ArtifactStore,
  type ArtifactStoreChange,
  type LoadedArtifactStoreEntry,
} from "@schema-ide/artifacts";
import { makeLocalGitCommitter, type LocalGitCommitter } from "@schema-ide/git-artifacts/node";
import { Duration, Effect, Fiber, FileSystem, Layer, Path, Queue, Stream } from "effect";
import { matchesAny, normalizeWorkspacePath } from "./glob";
import type { SchemaIdeCliProjectConfig } from "./index";

export interface LocalFilesystemArtifactProjectClientOptions {
  readonly project: SchemaIdeCliProjectConfig;
  readonly directory: string;
  readonly debounceMs?: number | undefined;
  readonly agentEnabled?: boolean | undefined;
  readonly title?: string | undefined;
}

export interface LocalFilesystemArtifactProject extends SchemaIdeArtifactProjectService {
  readonly close: Effect.Effect<void>;
}

const NodeArtifactProjectLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer);

export function createLocalFilesystemArtifactProjectClient({
  project,
  directory,
  debounceMs = 50,
  agentEnabled = false,
  title,
}: LocalFilesystemArtifactProjectClientOptions): LocalFilesystemArtifactProject {
  const root = directory;
  let revision = 0;
  let latestSnapshot: ArtifactProjectSnapshot | null = null;
  const subscribers = new Set<(event: ArtifactProjectEvent) => void>();
  // When the served directory is inside a git repo, version changes with real
  // commits so the local IDE shares history with the developer's git workflow.
  const gitCommitter: LocalGitCommitter | null = makeLocalGitCommitter({ directory: root });
  const projectMetadata = {
    id: project.id,
    title: title ?? project.id ?? root,
    readOnly: false,
  };
  const capabilities: ArtifactProjectCapabilities = {
    mode: "local-filesystem",
    project: projectMetadata,
    agent: {
      enabled: agentEnabled,
      ...(agentEnabled ? {} : { reason: "No OPENROUTER_API_KEY configured." }),
    },
    features: {
      watch: true,
      write: true,
      rename: true,
      delete: true,
      history: gitCommitter !== null,
      previews: true,
    },
  };

  const publish = (event: ArtifactProjectEvent) => {
    for (const subscriber of subscribers) subscriber(event);
  };

  /**
   * Commit the change to git (best-effort) after it has landed on disk. Paths
   * still present in the new snapshot are staged; vanished paths are removed.
   */
  const commitToGit = (
    change: ArtifactProjectChangeRequest,
    before: readonly SourceFile[],
    snapshot: ArtifactProjectSnapshot,
  ): Effect.Effect<void> => {
    if (!gitCommitter) return Effect.void;
    const present = new Set(snapshot.files.map((file) => file.path));
    const touched = changedPathsForChange(change, before);
    const changed = touched.filter((path) => present.has(path));
    const deleted = touched.filter((path) => !present.has(path));
    if (changed.length === 0 && deleted.length === 0) return Effect.void;
    return gitCommitter
      .commit({
        changed,
        deleted,
        message: workspaceChangeLabel(change),
        author: {
          name: "Schema IDE",
          email: "schema-ide@localhost",
          timestamp: Math.floor(Date.now() / 1000),
        },
      })
      .pipe(
        Effect.asVoid,
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            publish({ type: "error", message: `Git commit failed: ${String(cause)}` });
          }),
        ),
      );
  };

  const refresh: Effect.Effect<ArtifactProjectSnapshot, SchemaIdeArtifactProjectError> =
    runNodeEffect(
      Effect.gen(function* () {
        revision += 1;
        const files = yield* readSourceFilesEffect({
          directory: root,
          include: project.include,
          exclude: project.exclude,
        });
        return { revision, files };
      }).pipe(Effect.mapError(toWorkspaceError)),
    ).pipe(
      Effect.tap((snapshot) =>
        Effect.sync(() => {
          latestSnapshot = snapshot;
          publish({ type: "snapshot", snapshot });
        }),
      ),
    );

  const getSnapshot = Effect.suspend(() =>
    latestSnapshot ? Effect.succeed(latestSnapshot) : refresh,
  );

  const watcherFiber = Effect.runFork(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.watch(root).pipe(
        Stream.debounce(Duration.millis(debounceMs)),
        Stream.runForEach(() =>
          refresh.pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                publish({
                  type: "error",
                  message: error.message,
                });
              }),
            ),
          ),
        ),
      );
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          publish({
            type: "error",
            message: String(cause),
          });
        }),
      ),
      Effect.provide(NodeArtifactProjectLayer),
    ),
  );
  const watchArtifactProject = Stream.callback<ArtifactProjectEvent, SchemaIdeArtifactProjectError>(
    (queue) =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          const subscriber = (event: ArtifactProjectEvent) => Queue.offerUnsafe(queue, event);
          subscribers.add(subscriber);
          Queue.offerUnsafe(queue, { type: "capabilities", capabilities });
          Queue.offerUnsafe(queue, { type: "snapshot", snapshot: yield* getSnapshot });
          return subscriber;
        }),
        (subscriber) => Effect.sync(() => subscribers.delete(subscriber)),
      ),
  );

  return {
    getCapabilities: Effect.succeed(capabilities),
    getSnapshot,
    watchArtifactProject,
    applyChange: (change) =>
      Effect.gen(function* () {
        const before = (yield* getSnapshot).files;
        yield* runNodeEffect(applyFilesystemChange(root, change, before)).pipe(
          Effect.mapError(toWorkspaceError),
        );
        const snapshot = yield* refresh;
        yield* commitToGit(change, before, snapshot);
        const validationSummary = yield* artifactValidationSummary(project, snapshot);
        return {
          revision: snapshot.revision,
          changedPaths: changedPathsForChange(change, before),
          validationSummary,
        };
      }),
    previewFiles: ({ files, activeFile }) =>
      artifactReflection(project, files, activeFile).pipe(
        Effect.map((reflection) => ({
          reflection,
        })),
        Effect.mapError(toWorkspaceError),
      ),
    listArtifactRefs: getSnapshot.pipe(
      Effect.flatMap((snapshot) => {
        const runtime = createArtifactRuntime(project, snapshot);
        return runtime.store.list.pipe(
          Effect.map((refs) => {
            const projectRef = project.id
              ? { _tag: "Project" as const, projectId: project.id }
              : { _tag: "Project" as const };
            const artifacts = [projectRef, ...refs.filter(isProtocolArtifactRef)];
            return { artifacts, count: artifacts.length };
          }),
          Effect.mapError(toWorkspaceError),
        );
      }),
    ),
    getArtifactCapabilities: (request) =>
      getSnapshot.pipe(
        Effect.map((snapshot) => {
          const runtime = createArtifactRuntime(project, snapshot);
          return {
            capabilities: runtime.capabilities(request.ref).map((capability) => ({
              id: capability.id,
              type: capability.type,
              view: capability.view,
              annotations: capability.annotations,
              ...(capability.routeId ? { routeId: capability.routeId } : {}),
              ...(capability.routePattern ? { routePattern: capability.routePattern } : {}),
            })),
          };
        }),
      ),
    readArtifactView: (request) =>
      getSnapshot.pipe(
        Effect.flatMap((snapshot) => {
          const runtime = createArtifactRuntime(project, snapshot);
          return runtime.store.list.pipe(
            Effect.map((refs) => normalizeArtifactRef(request.ref, refs, project.id)),
            Effect.flatMap((ref) => runtime.view(ref, request.view)),
            Effect.map((value) => ({ ref: request.ref, view: request.view, value })),
            Effect.mapError(toWorkspaceError),
          );
        }),
      ),
    applyArtifactChange: (change) =>
      Effect.gen(function* () {
        const before = (yield* getSnapshot).files;
        const workspaceChange = artifactChangeToProjectChange(change);
        yield* runNodeEffect(applyFilesystemChange(root, workspaceChange, before)).pipe(
          Effect.mapError(toWorkspaceError),
        );
        const snapshot = yield* refresh;
        yield* commitToGit(workspaceChange, before, snapshot);
        const validationSummary = yield* artifactValidationSummary(project, snapshot);
        return {
          revision: snapshot.revision,
          changedPaths: changedPathsForChange(workspaceChange, before),
          validationSummary,
        };
      }),
    close: Effect.sync(() => {
      Effect.runFork(Fiber.interrupt(watcherFiber));
      subscribers.clear();
    }),
  };
}

function createArtifactRuntime(
  workspace: SchemaIdeCliProjectConfig,
  snapshot: ArtifactProjectSnapshot,
  activeFile?: string | null | undefined,
) {
  const selection = selectArtifactActiveFile(workspace, snapshot.files, activeFile);
  return createSchemaIdeArtifactRuntime({
    schema: workspace.schema,
    files: snapshot.files,
    activeFile: selection.activeFile,
    activeFormat: selection.activeFormat,
    ...(workspace.id ? { projectId: workspace.id } : {}),
    ...(workspace.artifactProject ? { project: workspace.artifactProject } : {}),
    ...(workspace.relationInputSchema
      ? { relationInputSchema: workspace.relationInputSchema }
      : {}),
    ...(workspace.relationSchema ? { relationSchema: workspace.relationSchema } : {}),
    ...(workspace.relationValue ? { relationValue: workspace.relationValue } : {}),
    ...(workspace.projectDiagnostics ? { projectDiagnostics: workspace.projectDiagnostics } : {}),
  });
}

function artifactReflection(
  workspace: SchemaIdeCliProjectConfig,
  files: readonly SourceFile[],
  activeFile?: string | null | undefined,
): Effect.Effect<SchemaIdeReflection, unknown> {
  const selection = selectArtifactActiveFile(workspace, files, activeFile);
  return createSchemaIdeArtifactRuntime({
    schema: workspace.schema,
    files,
    activeFile: selection.activeFile,
    activeFormat: selection.activeFormat,
    ...(workspace.id ? { projectId: workspace.id } : {}),
    ...(workspace.artifactProject ? { project: workspace.artifactProject } : {}),
    ...(workspace.relationInputSchema
      ? { relationInputSchema: workspace.relationInputSchema }
      : {}),
    ...(workspace.relationSchema ? { relationSchema: workspace.relationSchema } : {}),
    ...(workspace.relationValue ? { relationValue: workspace.relationValue } : {}),
    ...(workspace.projectDiagnostics ? { projectDiagnostics: workspace.projectDiagnostics } : {}),
  }).reflection;
}

function artifactValidationSummary(
  workspace: SchemaIdeCliProjectConfig,
  snapshot: ArtifactProjectSnapshot,
): Effect.Effect<SchemaIdeValidationSummaryDto, SchemaIdeArtifactProjectError> {
  return createArtifactRuntime(workspace, snapshot)
    .view(ArtifactRefFactory.project(workspace.id), "validationSummary")
    .pipe(
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
    ) as Effect.Effect<SchemaIdeValidationSummaryDto, SchemaIdeArtifactProjectError>;
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

function selectArtifactActiveFile(
  workspace: SchemaIdeCliProjectConfig,
  files: readonly SourceFile[],
  activeFile?: string | null | undefined,
): {
  readonly activeFile: string | null;
  readonly activeFormat: ReturnType<typeof formatForPath>;
} {
  const selectedFile = activeFile
    ? (files.find((file) => file.path === activeFile) ?? files[0] ?? null)
    : (files[0] ?? null);
  const selectedPath = selectedFile?.path ?? null;
  return {
    activeFile: selectedPath,
    activeFormat: selectedPath
      ? formatForPath(selectedPath, workspace.defaultFormat ?? "json")
      : (workspace.defaultFormat ?? "json"),
  };
}

function normalizeArtifactRef(
  ref: Parameters<SchemaIdeArtifactProjectService["readArtifactView"]>[0]["ref"],
  refs: readonly {
    readonly _tag: string;
    readonly path?: string | undefined;
    readonly projectId?: string | undefined;
  }[],
  projectId: string | undefined,
) {
  if (ref._tag === "Project" && !ref.projectId && projectId) {
    return { _tag: "Project" as const, projectId: projectId };
  }
  if (ref._tag !== "ProjectFile") return ref;
  const existing = refs.find(
    (candidate) => candidate._tag === "ProjectFile" && candidate.path === ref.path,
  );
  const resolvedProjectId = existing?.projectId ?? ref.projectId ?? projectId;
  return resolvedProjectId
    ? { _tag: "ProjectFile" as const, path: ref.path, projectId: resolvedProjectId }
    : ref;
}

function isProtocolArtifactRef(ref: {
  readonly _tag: string;
  readonly path?: string | undefined;
  readonly projectId?: string | undefined;
}): ref is ArtifactRef {
  return ref._tag === "Project" || (ref._tag === "ProjectFile" && typeof ref.path === "string");
}

function readSourceFilesEffect({
  directory,
  include = ["**/*.json", "**/*.yaml", "**/*.yml"],
  exclude = [".git/**", "node_modules/**", "dist/**", "coverage/**"],
}: {
  readonly directory: string;
  readonly include?: readonly string[] | undefined;
  readonly exclude?: readonly string[] | undefined;
}) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = path.resolve(directory);
    const rootStat = yield* fs.stat(root);
    if (rootStat.type !== "Directory") {
      return yield* Effect.fail(new Error(`Project directory is not a directory: ${directory}`));
    }

    const entries = yield* fs.readDirectory(root, { recursive: true });
    const files: SourceFile[] = [];
    for (const entry of entries) {
      const normalized = normalizeWorkspacePath(entry, path.sep);
      if (matchesAny(normalized, exclude) || !matchesAny(normalized, include)) continue;

      const absolutePath = path.resolve(root, normalized);
      const info = yield* fs.stat(absolutePath);
      if (info.type !== "File") continue;
      files.push({
        path: normalized,
        content: isBinaryWorkspacePath(normalized)
          ? Buffer.from(yield* fs.readFile(absolutePath)).toString("base64")
          : yield* fs.readFileString(absolutePath),
      });
    }
    return files.sort((left, right) => left.path.localeCompare(right.path));
  });
}

function applyFilesystemChange(
  root: string,
  change: ArtifactProjectChangeRequest,
  before: readonly SourceFile[],
) {
  return Effect.gen(function* () {
    yield* validateFilesystemChangePaths(root, change);
    const next = yield* filesFromArtifactStoreChange(before, change, workspaceChangeLabel(change));
    yield* writeFilesystemFiles(root, next, before);
  });
}

function validateFilesystemChangePaths(root: string, change: ArtifactProjectChangeRequest) {
  return Effect.gen(function* () {
    switch (change.type) {
      case "writeFile":
      case "createFile":
      case "deleteFile":
        yield* resolveSafeWorkspacePathEffect(root, change.path);
        return;
      case "renameFile":
        yield* resolveSafeWorkspacePathEffect(root, change.fromPath);
        yield* resolveSafeWorkspacePathEffect(root, change.toPath);
        return;
      case "replaceFiles":
        for (const file of change.files) {
          yield* resolveSafeWorkspacePathEffect(root, file.path);
        }
        return;
    }
  });
}

function filesFromArtifactStoreChange(
  before: readonly SourceFile[],
  change: ArtifactProjectChangeRequest,
  label: string,
): Effect.Effect<readonly SourceFile[], SchemaIdeArtifactProjectError> {
  return Effect.gen(function* () {
    const store = createMemoryArtifactStore({ files: before });
    const versionedStore = createVersionedArtifactStore(store);
    const refs = yield* store.list;
    const artifactChange = yield* workspaceChangeToArtifactStoreChange(store, refs, change);
    yield* versionedStore
      .apply(artifactChange, { actor: "user", label })
      .pipe(Effect.mapError(toWorkspaceError));
    return yield* sourceFilesFromArtifactStore(store);
  });
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
        ref: ArtifactRefFactory.projectFile(normalizeWorkspacePath(change.path, "/")),
        content: change.content,
      });
    case "createFile":
      return Effect.succeed({
        type: "create",
        ref: ArtifactRefFactory.projectFile(normalizeWorkspacePath(change.path, "/")),
        content: change.content,
      });
    case "deleteFile":
      return Effect.succeed({
        type: "delete",
        ref: ArtifactRefFactory.projectFile(normalizeWorkspacePath(change.path, "/")),
      });
    case "renameFile":
      return Effect.gen(function* () {
        const fromPath = normalizeWorkspacePath(change.fromPath, "/");
        const toPath = normalizeWorkspacePath(change.toPath, "/");
        const from = refs.find((ref) => ref._tag === "ProjectFile" && ref.path === fromPath);
        if (!from) {
          return yield* Effect.fail(
            new SchemaIdeArtifactProjectError(`File not found: ${change.fromPath}`, "not-found"),
          );
        }
        if (
          fromPath !== toPath &&
          refs.some((ref) => ref._tag === "ProjectFile" && ref.path === toPath)
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
            entry.ref === from ? { ...entry, ref: ArtifactRefFactory.projectFile(toPath) } : entry,
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

function writeFilesystemFiles(
  root: string,
  next: readonly SourceFile[],
  before: readonly SourceFile[],
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const nextPaths = new Set<string>();
    for (const file of next) {
      yield* resolveSafeWorkspacePathEffect(root, file.path);
      nextPaths.add(normalizeWorkspacePath(file.path, "/"));
    }
    for (const file of next) {
      yield* writeProjectFile(root, file.path, file.content);
    }
    for (const file of before) {
      if (!nextPaths.has(file.path)) {
        yield* fs.remove(yield* resolveSafeWorkspacePathEffect(root, file.path), {
          force: true,
        });
      }
    }
  });
}

function sourceFilesToArtifactStoreEntries(
  files: readonly SourceFile[],
): readonly LoadedArtifactStoreEntry[] {
  return files.map((file) =>
    loadedEntry(
      ArtifactRefFactory.projectFile(normalizeWorkspacePath(file.path, "/")),
      file.content,
    ),
  );
}

function artifactStoreEntries(
  store: ArtifactStore,
  refs: readonly ArtifactRefDefinition[],
): Effect.Effect<readonly LoadedArtifactStoreEntry[], SchemaIdeArtifactProjectError> {
  return Effect.forEach(
    refs.filter((ref) => ref._tag === "ProjectFile"),
    (ref) =>
      store.read(ref).pipe(
        Effect.map((content) => loadedEntry(ref, content)),
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
              content:
                typeof content === "string" ? content : Buffer.from(content).toString("base64"),
            })),
            Effect.mapError(toWorkspaceError),
          ),
      ),
    ),
    Effect.map((files) => files.sort((left, right) => left.path.localeCompare(right.path))),
    Effect.mapError(toWorkspaceError),
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

function writeProjectFile(root: string, filePath: string, content: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const absolutePath = yield* resolveSafeWorkspacePathEffect(root, filePath);
    yield* fs.makeDirectory(path.dirname(absolutePath), { recursive: true });
    if (isBinaryWorkspacePath(filePath)) {
      yield* fs.writeFile(absolutePath, decodeBinaryWorkspaceContent(content));
    } else {
      yield* fs.writeFileString(absolutePath, content);
    }
  });
}

function isBinaryWorkspacePath(path: string): boolean {
  return /\.(?:pdf|png|jpe?g|webp)$/i.test(path);
}

function decodeBinaryWorkspaceContent(content: string): Uint8Array {
  const trimmed = content.trim();
  const dataUrlMatch = trimmed.match(/^data:[^,]*;base64,([\s\S]*)$/i);
  return Buffer.from((dataUrlMatch?.[1] ?? trimmed).replace(/\s+/g, ""), "base64");
}

export function resolveSafeWorkspacePath(root: string, filePath: string): string {
  return Effect.runSync(
    resolveSafeWorkspacePathEffect(root, filePath).pipe(Effect.provide(Path.layer)),
  );
}

function resolveSafeWorkspacePathEffect(root: string, filePath: string) {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    if (path.isAbsolute(filePath)) {
      return yield* Effect.fail(
        new SchemaIdeArtifactProjectError(
          `Absolute workspace paths are not allowed: ${filePath}`,
          "unsafe-path",
        ),
      );
    }
    const normalized = normalizeWorkspacePath(filePath, path.sep);
    if (!normalized || normalized === "." || normalized.startsWith("../") || normalized === "..") {
      return yield* Effect.fail(
        new SchemaIdeArtifactProjectError(`Unsafe workspace path: ${filePath}`, "unsafe-path"),
      );
    }
    const absolutePath = path.resolve(root, normalized);
    const relativePath = path.relative(root, absolutePath);
    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      return yield* Effect.fail(
        new SchemaIdeArtifactProjectError(
          `Workspace path escapes root: ${filePath}`,
          "unsafe-path",
        ),
      );
    }
    return absolutePath;
  });
}

function changedPathsForChange(
  change: ArtifactProjectChangeRequest,
  before: readonly SourceFile[],
): readonly string[] {
  const sep = "/";
  switch (change.type) {
    case "writeFile":
    case "createFile":
    case "deleteFile":
      return [normalizeWorkspacePath(change.path, sep)];
    case "renameFile":
      return [
        normalizeWorkspacePath(change.fromPath, sep),
        normalizeWorkspacePath(change.toPath, sep),
      ];
    case "replaceFiles": {
      const beforeByPath = new Map(before.map((file) => [file.path, file.content]));
      return change.files
        .filter((file) => beforeByPath.get(file.path) !== file.content)
        .map((file) => normalizeWorkspacePath(file.path, sep));
    }
  }
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

function runNodeEffect<A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
): Effect.Effect<A, E> {
  return effect.pipe(Effect.provide(NodeArtifactProjectLayer)) as Effect.Effect<A, E>;
}
