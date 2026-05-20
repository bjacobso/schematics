import { NodeFileSystem, NodePath } from "@effect/platform-node";
import {
  createReflection,
  formatForPath,
  validateSchemaIdeValue,
  type SchemaIdeReflection,
  type SourceFile,
} from "@schema-ide/core";
import {
  type SchemaIdeWorkspaceClient,
  SchemaIdeWorkspaceError,
  type WorkspaceCapabilities,
  type WorkspaceChangeRequest,
  type WorkspaceEvent,
  type WorkspaceSnapshot,
} from "@schema-ide/protocol";
import { Duration, Effect, Fiber, FileSystem, Layer, Path, Stream } from "effect";
import type { SchemaIdeCliWorkspace } from "./index";

export interface LocalFilesystemWorkspaceClientOptions {
  readonly workspace: SchemaIdeCliWorkspace;
  readonly directory: string;
  readonly debounceMs?: number | undefined;
  readonly agentEnabled?: boolean | undefined;
  readonly title?: string | undefined;
}

export interface LocalFilesystemWorkspaceClient extends SchemaIdeWorkspaceClient {
  readonly close: () => void;
}

const NodeWorkspaceLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer);

export function createLocalFilesystemWorkspaceClient({
  workspace,
  directory,
  debounceMs = 50,
  agentEnabled = false,
  title,
}: LocalFilesystemWorkspaceClientOptions): LocalFilesystemWorkspaceClient {
  const root = directory;
  let revision = 0;
  let currentSnapshotPromise: Promise<WorkspaceSnapshot> | null = null;
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

  const refresh = async (): Promise<WorkspaceSnapshot> => {
    currentSnapshotPromise = runNodeEffect(
      Effect.gen(function* () {
        revision += 1;
        const files = yield* readSourceFilesEffect({
          directory: root,
          include: workspace.include,
          exclude: workspace.exclude,
        });
        const reflection = reflectWorkspace(workspace, files);
        return { revision, files, reflection };
      }),
    );
    const snapshot = await currentSnapshotPromise;
    publish({ type: "snapshot", snapshot });
    return snapshot;
  };

  const watcherFiber = Effect.runFork(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.watch(root).pipe(
        Stream.debounce(Duration.millis(debounceMs)),
        Stream.runForEach(() =>
          Effect.promise(() =>
            refresh().catch((error: unknown) => {
              publish({
                type: "error",
                message: error instanceof Error ? error.message : String(error),
              });
            }),
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

  const getSnapshot = async () => currentSnapshotPromise ?? refresh();

  return {
    getCapabilities: async () => capabilities,
    getSnapshot,
    watchWorkspace: (onEvent) => {
      subscribers.add(onEvent);
      onEvent({ type: "capabilities", capabilities });
      getSnapshot()
        .then((snapshot) => onEvent({ type: "snapshot", snapshot }))
        .catch((error: unknown) =>
          onEvent({
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      return {
        unsubscribe: () => {
          subscribers.delete(onEvent);
        },
      };
    },
    applyChange: async (change) => {
      const before = (await getSnapshot()).files;
      await runNodeEffect(applyFilesystemChange(root, change, before));
      const snapshot = await refresh();
      return {
        revision: snapshot.revision,
        changedPaths: changedPathsForChange(change, before),
        validationSummary: snapshot.reflection.validationSummary,
      };
    },
    close: () => {
      Effect.runFork(Fiber.interrupt(watcherFiber));
      subscribers.clear();
    },
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
): SchemaIdeReflection {
  const selectedFile = files[0] ?? null;
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
        yield* fs.remove(yield* resolveSafeWorkspacePathEffect(root, change.path), { force: false });
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
    resolveSafeWorkspacePathEffect(root, filePath).pipe(
      Effect.provide(Path.layer),
    ),
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

function normalizeWorkspacePath(filePath: string, sep: string): string {
  return filePath.split(sep).join("/").replace(/^\.\//, "").replace(/^\/+/, "");
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

function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globToRegExp(normalizeWorkspacePath(pattern, "/")).test(path));
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === undefined) continue;
    const next = pattern[index + 1];
    const afterNext = pattern[index + 2];

    if (char === "*" && next === "*" && afterNext === "/") {
      source += "(?:.*/)?";
      index += 2;
      continue;
    }

    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegExp(char);
  }

  return new RegExp(`${source}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runNodeEffect<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) {
  return Effect.runPromise(effect.pipe(Effect.provide(NodeWorkspaceLayer)));
}
