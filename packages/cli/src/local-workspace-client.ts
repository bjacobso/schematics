import { NodeFileSystem, NodePath } from "@effect/platform-node";
import {
  createReflection,
  formatForPath,
  validateSchemaIdeValue,
  type SchemaIdeReflection,
  type SourceFile,
} from "@schema-ide/core";
import {
  SchemaIdeWorkspaceError,
  type SchemaIdeWorkspaceService,
  type WorkspaceCapabilities,
  type WorkspaceChangeRequest,
  type WorkspaceEvent,
  type WorkspaceSnapshot,
} from "@schema-ide/protocol";
import { Duration, Effect, Fiber, FileSystem, Layer, Path, Queue, Stream } from "effect";
import { matchesAny, normalizeWorkspacePath } from "./glob";
import type { SchemaIdeCliWorkspace } from "./index";

export interface LocalFilesystemWorkspaceClientOptions {
  readonly workspace: SchemaIdeCliWorkspace;
  readonly directory: string;
  readonly debounceMs?: number | undefined;
  readonly agentEnabled?: boolean | undefined;
  readonly title?: string | undefined;
}

export interface LocalFilesystemWorkspace extends SchemaIdeWorkspaceService {
  readonly close: Effect.Effect<void>;
}

const NodeWorkspaceLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer);

export function createLocalFilesystemWorkspaceClient({
  workspace,
  directory,
  debounceMs = 50,
  agentEnabled = false,
  title,
}: LocalFilesystemWorkspaceClientOptions): LocalFilesystemWorkspace {
  const root = directory;
  let revision = 0;
  let latestSnapshot: WorkspaceSnapshot | null = null;
  const subscribers = new Set<(event: WorkspaceEvent) => void>();
  const capabilities: WorkspaceCapabilities = {
    mode: "local-filesystem",
    workspace: {
      id: workspace.id,
      title: title ?? workspace.id ?? root,
      readOnly: false,
    },
    agent: {
      enabled: agentEnabled,
      ...(agentEnabled ? {} : { reason: "No OPENROUTER_API_KEY configured." }),
    },
    features: {
      watch: true,
      write: true,
      rename: true,
      delete: true,
      history: false,
      previews: true,
    },
  };

  const publish = (event: WorkspaceEvent) => {
    for (const subscriber of subscribers) subscriber(event);
  };

  const refresh: Effect.Effect<WorkspaceSnapshot, SchemaIdeWorkspaceError> = runNodeEffect(
    Effect.gen(function* () {
      revision += 1;
      const files = yield* readSourceFilesEffect({
        directory: root,
        include: workspace.include,
        exclude: workspace.exclude,
      });
      const reflection = reflectWorkspace(workspace, files);
      return { revision, files, reflection };
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
      Effect.provide(NodeWorkspaceLayer),
    ),
  );

  return {
    getCapabilities: Effect.succeed(capabilities),
    getSnapshot,
    watchWorkspace: Stream.callback<WorkspaceEvent, SchemaIdeWorkspaceError>((queue) =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          const subscriber = (event: WorkspaceEvent) => Queue.offerUnsafe(queue, event);
          subscribers.add(subscriber);
          Queue.offerUnsafe(queue, { type: "capabilities", capabilities });
          Queue.offerUnsafe(queue, { type: "snapshot", snapshot: yield* getSnapshot });
          return subscriber;
        }),
        (subscriber) => Effect.sync(() => subscribers.delete(subscriber)),
      ),
    ),
    applyChange: (change) =>
      Effect.gen(function* () {
        const before = (yield* getSnapshot).files;
        yield* runNodeEffect(applyFilesystemChange(root, change, before)).pipe(
          Effect.mapError(toWorkspaceError),
        );
        const snapshot = yield* refresh;
        return {
          revision: snapshot.revision,
          changedPaths: changedPathsForChange(change, before),
          validationSummary: snapshot.reflection.validationSummary,
        };
      }),
    previewFiles: ({ files, activeFile }) =>
      Effect.succeed({
        reflection: reflectWorkspace(workspace, files, activeFile),
      }),
    close: Effect.sync(() => {
      Effect.runFork(Fiber.interrupt(watcherFiber));
      subscribers.clear();
    }),
  };
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
      return yield* Effect.fail(new Error(`Workspace directory is not a directory: ${directory}`));
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
        content: yield* fs.readFileString(absolutePath),
      });
    }
    return files.sort((left, right) => left.path.localeCompare(right.path));
  });
}

function reflectWorkspace(
  workspace: SchemaIdeCliWorkspace,
  files: readonly SourceFile[],
  activeFile?: string | null | undefined,
): SchemaIdeReflection {
  const selectedFile = activeFile
    ? (files.find((file) => file.path === activeFile) ?? files[0] ?? null)
    : (files[0] ?? null);
  const activeFormat = selectedFile
    ? formatForPath(selectedFile.path, workspace.defaultFormat ?? "json")
    : (workspace.defaultFormat ?? "json");
  const validation = validateSchemaIdeValue({
    schema: workspace.schema,
    files,
    activeFile: selectedFile?.path ?? null,
    activeFormat,
  });

  return createReflection({
    schema: workspace.schema,
    files,
    activeFile: selectedFile?.path ?? null,
    activeFormat,
    validation,
  });
}

function applyFilesystemChange(
  root: string,
  change: WorkspaceChangeRequest,
  before: readonly SourceFile[],
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    switch (change.type) {
      case "writeFile":
        yield* writeWorkspaceFile(root, change.path, change.content);
        return;
      case "createFile": {
        if (before.some((file) => file.path === normalizeWorkspacePath(change.path, path.sep))) {
          return yield* Effect.fail(
            new SchemaIdeWorkspaceError(`File already exists: ${change.path}`, "already-exists"),
          );
        }
        yield* writeWorkspaceFile(root, change.path, change.content);
        return;
      }
      case "deleteFile":
        yield* fs.remove(yield* resolveSafeWorkspacePathEffect(root, change.path), {
          force: false,
        });
        return;
      case "renameFile": {
        const toPath = yield* resolveSafeWorkspacePathEffect(root, change.toPath);
        yield* fs.makeDirectory(path.dirname(toPath), { recursive: true });
        yield* fs.rename(yield* resolveSafeWorkspacePathEffect(root, change.fromPath), toPath);
        return;
      }
      case "replaceFiles": {
        const nextPaths = new Set(
          change.files.map((file) => normalizeWorkspacePath(file.path, path.sep)),
        );
        for (const file of before) {
          if (!nextPaths.has(file.path)) {
            yield* fs.remove(yield* resolveSafeWorkspacePathEffect(root, file.path), {
              force: true,
            });
          }
        }
        for (const file of change.files) {
          yield* writeWorkspaceFile(root, file.path, file.content);
        }
        return;
      }
    }
  });
}

function writeWorkspaceFile(root: string, filePath: string, content: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const absolutePath = yield* resolveSafeWorkspacePathEffect(root, filePath);
    yield* fs.makeDirectory(path.dirname(absolutePath), { recursive: true });
    yield* fs.writeFileString(absolutePath, content);
  });
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
        new SchemaIdeWorkspaceError(
          `Absolute workspace paths are not allowed: ${filePath}`,
          "unsafe-path",
        ),
      );
    }
    const normalized = normalizeWorkspacePath(filePath, path.sep);
    if (!normalized || normalized === "." || normalized.startsWith("../") || normalized === "..") {
      return yield* Effect.fail(
        new SchemaIdeWorkspaceError(`Unsafe workspace path: ${filePath}`, "unsafe-path"),
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
        new SchemaIdeWorkspaceError(`Workspace path escapes root: ${filePath}`, "unsafe-path"),
      );
    }
    return absolutePath;
  });
}

function changedPathsForChange(
  change: WorkspaceChangeRequest,
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

function toWorkspaceError(error: unknown): SchemaIdeWorkspaceError {
  if (error instanceof SchemaIdeWorkspaceError) return error;
  return new SchemaIdeWorkspaceError(
    error instanceof Error ? error.message : String(error),
    "storage",
  );
}

function runNodeEffect<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) {
  return effect.pipe(Effect.provide(NodeWorkspaceLayer));
}
