import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Path } from "effect";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  compareWorkspaceFiles,
  createReflection,
  formatForPath,
  mergeWorkspaceFiles,
  validateSchemaIdeValue,
  type ReflectedSchema,
  type SchemaIdeDocumentFormat,
  type SchemaIdeDiagnostic,
  type SchemaIdeInputSchema,
  type SchemaIdeReflection,
  type SourceFile,
  type WorkspaceBranchComparison,
  type WorkspaceBranchMergeStrategy,
  type WorkspaceBranchMetadata,
  type WorkspaceMergeConflict,
  type WorkspaceRouteMap,
} from "@schema-ide/core";
import {
  runSchemaIdeHttpServer,
  type SchemaIdeNodeServerHandle,
  type SchemaIdeStaticAssets,
} from "@schema-ide/server";
import {
  SchemaIdeWorkspaceError,
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
} from "@schema-ide/protocol";
import {
  createLocalFilesystemWorkspaceClient,
  resolveSafeWorkspacePath,
  type LocalFilesystemWorkspace,
  type LocalFilesystemWorkspaceClientOptions,
} from "./local-workspace-client";
import { matchesAny, normalizeWorkspacePath } from "./glob";

const NodeCliLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const execFileAsync = promisify(execFile);

export {
  createLocalFilesystemWorkspaceClient,
  resolveSafeWorkspacePath,
  type LocalFilesystemWorkspace,
  type LocalFilesystemWorkspaceClientOptions,
};

export const defaultCliInclude = [
  "**/*.json",
  "**/*.yaml",
  "**/*.yml",
  "**/*.pdf",
  "**/*.png",
  "**/*.jpg",
  "**/*.jpeg",
  "**/*.webp",
] as const;
export const defaultCliExclude = [
  ".git/**",
  ".schema-ide/**",
  "node_modules/**",
  "dist/**",
  "coverage/**",
] as const;

export interface SchemaIdeCliWorkspace<
  A = unknown,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
> {
  readonly id?: string | undefined;
  readonly schema: SchemaIdeInputSchema<A, Routes>;
  readonly defaultFormat?: SchemaIdeDocumentFormat | undefined;
  readonly include?: readonly string[] | undefined;
  readonly exclude?: readonly string[] | undefined;
}

export interface ReadSourceFilesOptions {
  readonly directory: string;
  readonly include?: readonly string[] | undefined;
  readonly exclude?: readonly string[] | undefined;
}

export interface ValidateWorkspaceDirectoryOptions<
  A = unknown,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
> {
  readonly workspace: SchemaIdeCliWorkspace<A, Routes>;
  readonly directory: string;
  readonly activeFile?: string | null | undefined;
}

export interface WorkspaceConfigModule<
  A = unknown,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
> {
  readonly default?: SchemaIdeCliWorkspace<A, Routes> | undefined;
  readonly workspace?: SchemaIdeCliWorkspace<A, Routes> | undefined;
}

export interface SchemaIdeCliOptions<
  A = unknown,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
> {
  readonly name?: string | undefined;
  readonly workspace?: SchemaIdeCliWorkspace<A, Routes> | undefined;
  readonly schemaPath?: string | undefined;
  readonly staticAssets?: SchemaIdeStaticAssets | undefined;
}

export interface EmbeddedSchemaIdeCliOptions<
  A = unknown,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
> {
  readonly name?: string | undefined;
  readonly workspace: SchemaIdeCliWorkspace<A, Routes>;
  readonly staticAssets?: SchemaIdeStaticAssets | undefined;
}

export interface SchemaIdeCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface SchemaIdeCli {
  readonly run: (argv: readonly string[]) => Promise<SchemaIdeCliResult>;
  readonly main: (argv?: readonly string[]) => Promise<void>;
}

interface ParsedCliOptions {
  readonly command: "validate" | "routes" | "schema" | "inspect" | "serve" | "web" | "help";
  readonly schemaPath: string | null;
  readonly directory: string;
  readonly json: boolean;
  readonly activeFile: string | null;
  readonly schemaId: string | null;
  readonly port: number | null;
  readonly staticDir: string | null;
}

export interface SchemaIdeServeOptions {
  readonly workspace: SchemaIdeCliWorkspace;
  readonly directory: string;
  readonly port?: number | undefined;
  readonly staticDir?: string | undefined;
  readonly staticAssets?: SchemaIdeStaticAssets | undefined;
  readonly openRouterApiKey?: string | undefined;
  readonly workspaceRpcProtocol?: "http" | "websocket" | undefined;
}

export interface LocalFilesystemBranchManagerOptions {
  readonly workspace: SchemaIdeCliWorkspace;
  readonly directory: string;
  readonly gitWorktrees?: boolean | undefined;
  readonly gitWorktreeDirectory?: string | undefined;
}

export interface LocalFilesystemCreateBranchRequest {
  readonly fromBranchId?: string | undefined;
  readonly name?: string | undefined;
  readonly title?: string | undefined;
  readonly createdBy?: "user" | "agent" | "system" | undefined;
}

export interface LocalFilesystemMergeBranchRequest {
  readonly sourceBranchId: string;
  readonly targetBranchId?: string | undefined;
  readonly deleteSource?: boolean | undefined;
  readonly strategy?: WorkspaceBranchMergeStrategy | undefined;
}

export type LocalFilesystemMergeBranchResponse =
  | {
      readonly status: "merged";
      readonly targetBranch: WorkspaceBranchMetadata;
    }
  | {
      readonly status: "conflicts";
      readonly conflicts: readonly WorkspaceMergeConflict[];
      readonly comparison: WorkspaceBranchComparison;
    };

export interface LocalFilesystemWorkspaceBranchManager {
  readonly listBranches: () => Promise<readonly WorkspaceBranchMetadata[]>;
  readonly createBranch: (
    request?: LocalFilesystemCreateBranchRequest,
  ) => Promise<{ readonly branch: WorkspaceBranchMetadata }>;
  readonly compareBranch: (request: {
    readonly sourceBranchId: string;
    readonly targetBranchId?: string | undefined;
  }) => Promise<WorkspaceBranchComparison>;
  readonly mergeBranch: (
    request: LocalFilesystemMergeBranchRequest,
  ) => Promise<LocalFilesystemMergeBranchResponse>;
  readonly archiveBranch: (branchId: string) => Promise<WorkspaceBranchMetadata>;
  readonly deleteBranch: (branchId: string) => Promise<void>;
  readonly getWorkspaceClient: (branchId?: string | undefined) => LocalFilesystemWorkspace;
}

interface LocalFilesystemBranchRecord extends WorkspaceBranchMetadata {
  readonly revision: number;
  readonly worktreePath?: string | undefined;
}

interface LocalFilesystemBranchesFile {
  readonly branches: readonly LocalFilesystemBranchRecord[];
}

export function defineSchemaIdeWorkspace<A, Routes extends WorkspaceRouteMap = WorkspaceRouteMap>(
  workspace: SchemaIdeCliWorkspace<A, Routes>,
): SchemaIdeCliWorkspace<A, Routes> {
  return workspace;
}

export function createSchemaIdeCli(options: SchemaIdeCliOptions = {}): SchemaIdeCli {
  return {
    run: (argv) => runSchemaIdeCli(argv, options),
    main: (argv) => runSchemaIdeCliMain(argv ?? process.argv.slice(2), options),
  };
}

export function createEmbeddedSchemaIdeCli(options: EmbeddedSchemaIdeCliOptions): SchemaIdeCli {
  return {
    run: (argv) => runEmbeddedSchemaIdeCli(argv, options),
    main: (argv) => runEmbeddedSchemaIdeCliMain(argv ?? process.argv.slice(2), options),
  };
}

export async function runSchemaIdeCli(
  argv: readonly string[],
  cliOptions: SchemaIdeCliOptions = {},
): Promise<SchemaIdeCliResult> {
  const options = parseArgs(argv, "validate");

  if (options.command === "help") {
    return { exitCode: 0, stdout: helpText(cliOptions), stderr: "" };
  }

  const workspace = await resolveCliWorkspace(options, cliOptions);
  if (!workspace) {
    return {
      exitCode: 2,
      stdout: "",
      stderr: `Missing required --schema <path> option.\n\n${helpText(cliOptions)}`,
    };
  }

  return runSchemaIdeCliCommand(options, workspace);
}

async function runSchemaIdeCliCommand(
  options: ParsedCliOptions,
  workspace: SchemaIdeCliWorkspace,
): Promise<SchemaIdeCliResult> {
  if (isServeCommand(options.command)) {
    return {
      exitCode: 0,
      stdout: `Starting local Schema IDE UI for ${options.directory}.\n`,
      stderr: "",
    };
  }

  const reflection = await validateWorkspaceDirectory({
    workspace,
    directory: options.directory,
    activeFile: options.activeFile,
  });

  if (options.command === "routes") {
    return {
      exitCode: 0,
      stdout: options.json
        ? `${JSON.stringify({ routeMatches: reflection.routeMatches }, null, 2)}\n`
        : formatRoutes(reflection),
      stderr: "",
    };
  }

  if (options.command === "schema") {
    const schema = selectSchema(reflection.schemas, options.schemaId);
    if (!schema) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `Schema not found: ${options.schemaId ?? "(active)"}\n`,
      };
    }

    return {
      exitCode: 0,
      stdout: options.json
        ? `${JSON.stringify(schema, null, 2)}\n`
        : `${JSON.stringify(schema.jsonSchema, null, 2)}\n`,
      stderr: "",
    };
  }

  if (options.command === "inspect") {
    return {
      exitCode: reflection.validationSummary.valid ? 0 : 1,
      stdout: `${JSON.stringify(summarizeReflection(reflection), null, 2)}\n`,
      stderr: "",
    };
  }

  return {
    exitCode: reflection.validationSummary.valid ? 0 : 1,
    stdout: options.json
      ? `${JSON.stringify(
          {
            summary: reflection.validationSummary,
            diagnostics: reflection.diagnostics,
            routeMatches: reflection.routeMatches,
          },
          null,
          2,
        )}\n`
      : formatValidation(reflection),
    stderr: "",
  };
}

async function runEmbeddedSchemaIdeCli(
  argv: readonly string[],
  cliOptions: EmbeddedSchemaIdeCliOptions,
): Promise<SchemaIdeCliResult> {
  const options = parseArgs(argv, "serve");

  if (options.command === "help") {
    return { exitCode: 0, stdout: helpText(cliOptions), stderr: "" };
  }

  if (options.schemaPath) {
    return {
      exitCode: 2,
      stdout: "",
      stderr: `This CLI embeds its workspace schema and does not accept --schema.\n\n${helpText(
        cliOptions,
      )}`,
    };
  }

  return runSchemaIdeCliCommand(options, cliOptions.workspace);
}

async function runSchemaIdeCliMain(
  argv: readonly string[],
  cliOptions: SchemaIdeCliOptions,
): Promise<void> {
  const options = parseArgs(argv, "validate");
  if (!isServeCommand(options.command)) {
    await writeCliResult(() => runSchemaIdeCli(argv, cliOptions));
    return;
  }

  try {
    const workspace = await resolveCliWorkspace(options, cliOptions);
    if (!workspace) {
      process.stderr.write(`Missing required --schema <path> option.\n\n${helpText(cliOptions)}`);
      process.exitCode = 2;
      return;
    }
    await runServeMain(workspace, options, cliOptions);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

async function runEmbeddedSchemaIdeCliMain(
  argv: readonly string[],
  cliOptions: EmbeddedSchemaIdeCliOptions,
): Promise<void> {
  const options = parseArgs(argv, "serve");
  if (!isServeCommand(options.command)) {
    await writeCliResult(() => runEmbeddedSchemaIdeCli(argv, cliOptions));
    return;
  }

  if (options.schemaPath) {
    process.stderr.write(
      `This CLI embeds its workspace schema and does not accept --schema.\n\n${helpText(
        cliOptions,
      )}`,
    );
    process.exitCode = 2;
    return;
  }

  try {
    await runServeMain(cliOptions.workspace, options, cliOptions);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

async function runServeMain(
  workspace: SchemaIdeCliWorkspace,
  options: ParsedCliOptions,
  cliOptions: Pick<SchemaIdeCliOptions, "staticAssets">,
): Promise<void> {
  const staticDir = options.staticDir ?? resolveDefaultStaticDir();
  const staticAssets = staticDir ? undefined : cliOptions.staticAssets;
  const server = await serveSchemaIdeWorkspace({
    workspace,
    directory: options.directory,
    port: options.port ?? 4318,
    staticDir,
    staticAssets,
  });
  process.stdout.write(`Schema IDE listening on http://127.0.0.1:${server.port}/\n`);
  if (!staticDir && !staticAssets && !process.env["SCHEMA_IDE_STATIC_DIR"]) {
    process.stdout.write(
      "No Schema IDE UI bundle was found. Build the playground or pass --static-dir to serve /.\n",
    );
  }
  const close = async () => {
    await server.close();
  };
  process.once("SIGINT", () => {
    void close().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void close().finally(() => process.exit(0));
  });
  await new Promise<never>(() => undefined);
}

async function writeCliResult(run: () => Promise<SchemaIdeCliResult>): Promise<void> {
  try {
    const result = await run();
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

export async function loadSchemaIdeWorkspaceConfig(
  configPath: string,
): Promise<SchemaIdeCliWorkspace> {
  const resolvedPath = await resolveCliPath(configPath);
  const module = await importConfigModule(resolvedPath);
  const workspace = module.default ?? module.workspace;

  if (!workspace || typeof workspace !== "object" || !("schema" in workspace)) {
    throw new Error(
      `Schema IDE config must export a workspace definition as default or named "workspace": ${configPath}`,
    );
  }

  return workspace as SchemaIdeCliWorkspace;
}

export async function serveSchemaIdeWorkspace({
  workspace,
  directory,
  port = 4318,
  staticDir = process.env["SCHEMA_IDE_STATIC_DIR"],
  staticAssets,
  openRouterApiKey = process.env["OPENROUTER_API_KEY"] ??
    process.env["SCHEMA_IDE_OPENROUTER_API_KEY"],
  workspaceRpcProtocol,
}: SchemaIdeServeOptions): Promise<SchemaIdeNodeServerHandle> {
  const workspaceService = createLocalFilesystemWorkspaceClient({
    workspace,
    directory,
    agentEnabled: Boolean(openRouterApiKey),
  });
  const branchManager = createLocalFilesystemWorkspaceBranchManager({ workspace, directory });
  const branchClients = new Map<string, LocalFilesystemWorkspace>();
  const workspaceBranch = (branchId: string) => {
    if (!isLocalBranchId(branchId)) return null;
    let client = branchClients.get(branchId);
    if (!client) {
      client = branchManager.getWorkspaceClient(branchId);
      branchClients.set(branchId, client);
    }
    return client;
  };
  const server = await runSchemaIdeHttpServer({
    port,
    staticDir,
    staticAssets: staticDir ? undefined : staticAssets,
    openRouterApiKey,
    workspace: workspaceService,
    workspaceBranches: createLocalFilesystemWorkspaceBranchService(branchManager),
    workspaceBranch,
    workspaceRpcProtocol,
  });
  const closeServer = server.close;
  return {
    port: server.port,
    close: async () => {
      await Effect.runPromise(workspaceService.close);
      for (const client of branchClients.values()) {
        await Effect.runPromise(client.close);
      }
      await closeServer();
    },
  };
}

export function createLocalFilesystemWorkspaceBranchService(
  manager: LocalFilesystemWorkspaceBranchManager,
): SchemaIdeWorkspaceBranchService {
  return {
    listBranches: Effect.tryPromise({
      try: () => manager.listBranches(),
      catch: toLocalBranchServiceError,
    }),
    createBranch: (request: CreateWorkspaceBranchRequest) =>
      Effect.tryPromise({
        try: async (): Promise<CreateWorkspaceBranchResponse> => manager.createBranch(request),
        catch: toLocalBranchServiceError,
      }),
    getBranch: (request: GetWorkspaceBranchRequest) =>
      Effect.tryPromise({
        try: async () => {
          const branch = (await manager.listBranches()).find(
            (candidate) => candidate.id === request.branchId,
          );
          if (!branch) throw new Error(`Workspace branch not found: ${request.branchId}`);
          return branch;
        },
        catch: toLocalBranchServiceError,
      }),
    compareBranch: (request: CompareWorkspaceBranchRequest) =>
      Effect.tryPromise({
        try: () => manager.compareBranch(request),
        catch: toLocalBranchServiceError,
      }),
    mergeBranch: (request: MergeWorkspaceBranchRequest) =>
      Effect.tryPromise({
        try: async (): Promise<MergeWorkspaceBranchResponse> => manager.mergeBranch(request),
        catch: toLocalBranchServiceError,
      }),
    deleteBranch: (request: DeleteWorkspaceBranchRequest) =>
      Effect.tryPromise({
        try: async (): Promise<DeleteWorkspaceBranchResponse> => {
          await manager.deleteBranch(request.branchId);
          return { branchId: request.branchId };
        },
        catch: toLocalBranchServiceError,
      }),
    archiveBranch: (request: ArchiveWorkspaceBranchRequest) =>
      Effect.tryPromise({
        try: async (): Promise<ArchiveWorkspaceBranchResponse> => ({
          branch: await manager.archiveBranch(request.branchId),
        }),
        catch: toLocalBranchServiceError,
      }),
  };
}

export function createLocalFilesystemWorkspaceBranchManager({
  workspace,
  directory,
  gitWorktrees = false,
  gitWorktreeDirectory,
}: LocalFilesystemBranchManagerOptions): LocalFilesystemWorkspaceBranchManager {
  const root = resolve(directory);
  const stateDirectory = join(root, ".schema-ide");
  const branchesDirectory = join(stateDirectory, "branches");
  const branchesFile = join(stateDirectory, "branches.json");
  const worktreesDirectory =
    gitWorktreeDirectory ??
    resolve(root, "..", ".schema-ide-worktrees", workspace.id ?? "workspace");

  const loadBranches = async (): Promise<readonly LocalFilesystemBranchRecord[]> => {
    if (!existsSync(branchesFile)) {
      return [await makeMainBranchRecord(root)];
    }
    const json = JSON.parse(await readFile(branchesFile, "utf8")) as LocalFilesystemBranchesFile;
    return json.branches.some((branch) => branch.id === "main")
      ? json.branches
      : [await makeMainBranchRecord(root), ...json.branches];
  };

  const saveBranches = async (branches: readonly LocalFilesystemBranchRecord[]) => {
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(branchesFile, `${JSON.stringify({ branches }, null, 2)}\n`);
  };

  const readBranchFiles = async (branchId: string) =>
    readSourceFilesFromDirectory({
      directory:
        branchId === "main"
          ? root
          : branchWorkDirectory(await getBranchRecord(branchId), branchesDirectory),
      include: workspace.include,
      exclude: workspace.exclude,
    });

  const readBranchBaseFiles = async (branchId: string) =>
    readSourceFilesFromDirectory({
      directory: branchBaseDirectory(branchesDirectory, branchId),
      include: workspace.include,
      exclude: workspace.exclude,
    });

  const getBranchRecord = async (branchId: string) => {
    const branch = (await loadBranches()).find((candidate) => candidate.id === branchId);
    if (!branch) throw new Error(`Workspace branch not found: ${branchId}`);
    return branch;
  };

  return {
    listBranches: async () => (await loadBranches()).map(toWorkspaceBranchMetadata),
    createBranch: async (request = {}) => {
      const sourceBranchId = request.fromBranchId ?? "main";
      const branches = await loadBranches();
      const source = branches.find((branch) => branch.id === sourceBranchId);
      if (!source) throw new Error(`Workspace branch not found: ${sourceBranchId}`);
      const files = await readBranchFiles(sourceBranchId);
      const branchId = uniqueLocalBranchId(branches);
      const now = Date.now();
      const worktreePath =
        gitWorktrees && sourceBranchId === "main"
          ? await tryCreateGitWorktreeBranch({ root, worktreesDirectory, branchId })
          : null;
      const branch: LocalFilesystemBranchRecord = {
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
        worktreePath: worktreePath ?? undefined,
      };

      if (!worktreePath) {
        await writeSourceFilesToDirectory(
          branchFilesDirectory(branchesDirectory, branchId),
          files,
          [],
        );
      }
      await writeSourceFilesToDirectory(
        branchBaseDirectory(branchesDirectory, branchId),
        files,
        [],
      );
      await saveBranches([...branches, branch]);
      return { branch: toWorkspaceBranchMetadata(branch) };
    },
    compareBranch: async ({ sourceBranchId, targetBranchId = "main" }) => {
      const source = await getBranchRecord(sourceBranchId);
      const target = await getBranchRecord(targetBranchId);
      const sourceFiles = await readBranchFiles(sourceBranchId);
      const targetFiles = await readBranchFiles(targetBranchId);
      const storedBaseFiles =
        sourceBranchId === "main" ? [] : await readBranchBaseFiles(sourceBranchId);
      const baseFiles = storedBaseFiles.length ? storedBaseFiles : targetFiles;
      const merge = mergeWorkspaceFiles({ baseFiles, targetFiles, sourceFiles });
      const validation = validateSchemaIdeValue({
        schema: workspace.schema,
        files: sourceFiles,
        activeFile: sourceFiles[0]?.path ?? null,
        activeFormat: sourceFiles[0]
          ? formatForPath(sourceFiles[0].path, workspace.defaultFormat ?? "json")
          : (workspace.defaultFormat ?? "json"),
      });

      return {
        baseRevisionId: source.baseRevisionId,
        sourceBranchId: source.id,
        targetBranchId: target.id,
        files: compareWorkspaceFiles(baseFiles, sourceFiles),
        validationSummary: validation.summary,
        mergeable: merge.status === "merged",
        conflicts: merge.status === "conflicts" ? merge.conflicts : [],
      };
    },
    mergeBranch: async ({
      sourceBranchId,
      targetBranchId = "main",
      deleteSource = false,
      strategy,
    }) => {
      const branches = await loadBranches();
      const source = branches.find((branch) => branch.id === sourceBranchId);
      const target = branches.find((branch) => branch.id === targetBranchId);
      if (!source) throw new Error(`Workspace branch not found: ${sourceBranchId}`);
      if (!target) throw new Error(`Workspace branch not found: ${targetBranchId}`);

      const sourceFiles = await readBranchFiles(sourceBranchId);
      const targetFiles = await readBranchFiles(targetBranchId);
      const storedBaseFiles =
        sourceBranchId === "main" ? [] : await readBranchBaseFiles(sourceBranchId);
      const baseFiles = storedBaseFiles.length ? storedBaseFiles : targetFiles;
      const merge = mergeWorkspaceFiles({ baseFiles, targetFiles, sourceFiles, strategy });
      const comparison = compareLocalFilesystemBranchFiles({
        workspace,
        source,
        target,
        sourceFiles,
        targetFiles,
        baseFiles,
      });

      if (merge.status === "conflicts") {
        return {
          status: "conflicts",
          conflicts: merge.conflicts,
          comparison: { ...comparison, mergeable: false, conflicts: merge.conflicts },
        };
      }

      await writeSourceFilesToDirectory(
        targetBranchId === "main" ? root : branchWorkDirectory(target, branchesDirectory),
        merge.files,
        targetFiles,
      );

      const now = Date.now();
      const nextTarget: LocalFilesystemBranchRecord = {
        ...target,
        revision: target.revision + 1,
        headRevisionId: `rev-${target.revision + 1}`,
        updatedAt: now,
      };
      const nextBranches = branches
        .map((branch) => (branch.id === target.id ? nextTarget : branch))
        .filter((branch) => !(deleteSource && branch.id === source.id && branch.kind !== "main"));
      await saveBranches(nextBranches);
      if (deleteSource && source.kind !== "main") {
        await rm(branchDirectory(branchesDirectory, source.id), { recursive: true, force: true });
        if (source.worktreePath) {
          await removeGitWorktree(root, source.worktreePath);
        }
      }

      return {
        status: "merged",
        targetBranch: toWorkspaceBranchMetadata(nextTarget),
      };
    },
    archiveBranch: async (branchId) => {
      const branches = await loadBranches();
      const branch = branches.find((candidate) => candidate.id === branchId);
      if (!branch) throw new Error(`Workspace branch not found: ${branchId}`);
      if (branch.kind === "main") throw new Error("Cannot archive the main workspace branch.");
      const archived: LocalFilesystemBranchRecord = {
        ...branch,
        kind: "archived",
        updatedAt: Date.now(),
      };
      await saveBranches(
        branches.map((candidate) => (candidate.id === branchId ? archived : candidate)),
      );
      return toWorkspaceBranchMetadata(archived);
    },
    deleteBranch: async (branchId) => {
      const branches = await loadBranches();
      const branch = branches.find((candidate) => candidate.id === branchId);
      if (!branch) throw new Error(`Workspace branch not found: ${branchId}`);
      if (branch.kind === "main") throw new Error("Cannot delete the main workspace branch.");
      await saveBranches(branches.filter((candidate) => candidate.id !== branchId));
      await rm(branchDirectory(branchesDirectory, branchId), { recursive: true, force: true });
      if (branch.worktreePath) {
        await removeGitWorktree(root, branch.worktreePath);
      }
    },
    getWorkspaceClient: (branchId = "main") =>
      createLocalFilesystemWorkspaceClient({
        workspace,
        directory:
          branchId === "main"
            ? root
            : branchWorkDirectorySync(branchesFile, branchesDirectory, branchId),
        title: branchId,
      }),
  };
}

export async function readSourceFilesFromDirectory({
  directory,
  include = defaultCliInclude,
  exclude = defaultCliExclude,
}: ReadSourceFilesOptions): Promise<readonly SourceFile[]> {
  return runCliEffect(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = path.resolve(directory);
      const rootStat = yield* fs.stat(root);

      if (rootStat.type !== "Directory") {
        return yield* Effect.fail(
          new Error(`Workspace directory is not a directory: ${directory}`),
        );
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
    }),
  );
}

export async function validateWorkspaceDirectory<
  A,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
>({
  workspace,
  directory,
  activeFile,
}: ValidateWorkspaceDirectoryOptions<A, Routes>): Promise<SchemaIdeReflection> {
  const files = await readSourceFilesFromDirectory({
    directory,
    include: workspace.include,
    exclude: workspace.exclude,
  });
  const selectedFile = resolveActiveFile(files, activeFile);
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

function isBinaryWorkspacePath(path: string): boolean {
  return /\.(?:pdf|png|jpe?g|webp)$/i.test(path);
}

async function makeMainBranchRecord(root: string): Promise<LocalFilesystemBranchRecord> {
  const now = Date.now();
  return {
    id: "main",
    name: "main",
    kind: "main",
    baseBranchId: null,
    baseRevisionId: null,
    headRevisionId: null,
    createdAt: now,
    updatedAt: now,
    title: root,
    revision: 0,
  };
}

async function writeSourceFilesToDirectory(
  directory: string,
  nextFiles: readonly SourceFile[],
  previousFiles: readonly SourceFile[],
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const nextPaths = new Set(nextFiles.map((file) => file.path));

  for (const file of previousFiles) {
    if (!nextPaths.has(file.path)) {
      await rm(resolveSafeWorkspacePath(directory, file.path), { force: true });
    }
  }

  for (const file of nextFiles) {
    const absolutePath = resolveSafeWorkspacePath(directory, file.path);
    await mkdir(dirname(absolutePath), { recursive: true });
    if (isBinaryWorkspacePath(file.path)) {
      await writeFile(absolutePath, decodeBinaryWorkspaceContent(file.content));
    } else {
      await writeFile(absolutePath, file.content);
    }
  }
}

function decodeBinaryWorkspaceContent(content: string): Uint8Array {
  const trimmed = content.trim();
  const dataUrlMatch = trimmed.match(/^data:[^,]*;base64,([\s\S]*)$/i);
  return Buffer.from((dataUrlMatch?.[1] ?? trimmed).replace(/\s+/g, ""), "base64");
}

function branchDirectory(branchesDirectory: string, branchId: string): string {
  assertLocalBranchId(branchId);
  return join(branchesDirectory, branchId);
}

function branchFilesDirectory(branchesDirectory: string, branchId: string): string {
  return join(branchDirectory(branchesDirectory, branchId), "files");
}

function branchWorkDirectory(
  branch: LocalFilesystemBranchRecord,
  branchesDirectory: string,
): string {
  return branch.worktreePath ?? branchFilesDirectory(branchesDirectory, branch.id);
}

function branchWorkDirectorySync(
  branchesFile: string,
  branchesDirectory: string,
  branchId: string,
): string {
  if (!existsSync(branchesFile)) return branchFilesDirectory(branchesDirectory, branchId);
  const json = JSON.parse(readFileSync(branchesFile, "utf8")) as LocalFilesystemBranchesFile;
  const branch = json.branches.find((candidate) => candidate.id === branchId);
  return branch?.worktreePath ?? branchFilesDirectory(branchesDirectory, branchId);
}

function branchBaseDirectory(branchesDirectory: string, branchId: string): string {
  return join(branchDirectory(branchesDirectory, branchId), "base");
}

function assertLocalBranchId(branchId: string): void {
  if (!isLocalBranchId(branchId)) {
    throw new Error(`Invalid workspace branch id: ${branchId}`);
  }
}

function isLocalBranchId(branchId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(branchId);
}

function toLocalBranchServiceError(error: unknown): SchemaIdeWorkspaceError {
  if (error instanceof SchemaIdeWorkspaceError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new SchemaIdeWorkspaceError(
    message,
    message.includes("not found") ? "not-found" : "storage",
  );
}

function uniqueLocalBranchId(branches: readonly LocalFilesystemBranchRecord[]): string {
  for (;;) {
    const branchId = `branch-${crypto.randomUUID()}`;
    if (!branches.some((branch) => branch.id === branchId)) return branchId;
  }
}

async function tryCreateGitWorktreeBranch({
  root,
  worktreesDirectory,
  branchId,
}: {
  readonly root: string;
  readonly worktreesDirectory: string;
  readonly branchId: string;
}): Promise<string | null> {
  try {
    await execFileAsync("git", ["-C", root, "rev-parse", "--show-toplevel"]);

    const status = (await execFileAsync("git", ["-C", root, "status", "--porcelain"])).stdout;
    if (status.trim()) return null;

    const worktreePath = join(worktreesDirectory, branchId);
    await mkdir(worktreesDirectory, { recursive: true });
    await execFileAsync("git", [
      "-C",
      root,
      "worktree",
      "add",
      "-b",
      `schema-ide/${branchId}`,
      worktreePath,
      "HEAD",
    ]);
    return worktreePath;
  } catch {
    return null;
  }
}

async function removeGitWorktree(root: string, worktreePath: string): Promise<void> {
  try {
    await execFileAsync("git", ["-C", root, "worktree", "remove", "--force", worktreePath]);
  } catch {
    await rm(worktreePath, { recursive: true, force: true });
  }
}

function toWorkspaceBranchMetadata(branch: LocalFilesystemBranchRecord): WorkspaceBranchMetadata {
  return {
    id: branch.id,
    name: branch.name,
    kind: branch.kind,
    baseBranchId: branch.baseBranchId,
    baseRevisionId: branch.baseRevisionId,
    headRevisionId: branch.headRevisionId,
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
    createdBy: branch.createdBy,
    title: branch.title,
  };
}

function compareLocalFilesystemBranchFiles({
  workspace,
  source,
  target,
  sourceFiles,
  targetFiles,
  baseFiles,
}: {
  readonly workspace: SchemaIdeCliWorkspace;
  readonly source: LocalFilesystemBranchRecord;
  readonly target: LocalFilesystemBranchRecord;
  readonly sourceFiles: readonly SourceFile[];
  readonly targetFiles: readonly SourceFile[];
  readonly baseFiles: readonly SourceFile[];
}): WorkspaceBranchComparison {
  const merge = mergeWorkspaceFiles({ baseFiles, targetFiles, sourceFiles });
  const validation = validateSchemaIdeValue({
    schema: workspace.schema,
    files: sourceFiles,
    activeFile: sourceFiles[0]?.path ?? null,
    activeFormat: sourceFiles[0]
      ? formatForPath(sourceFiles[0].path, workspace.defaultFormat ?? "json")
      : (workspace.defaultFormat ?? "json"),
  });

  return {
    baseRevisionId: source.baseRevisionId,
    sourceBranchId: source.id,
    targetBranchId: target.id,
    files: compareWorkspaceFiles(baseFiles, sourceFiles),
    validationSummary: validation.summary,
    mergeable: merge.status === "merged",
    conflicts: merge.status === "conflicts" ? merge.conflicts : [],
  };
}

async function importConfigModule(configPath: string): Promise<WorkspaceConfigModule> {
  if (isTypeScriptPath(configPath)) {
    const { tsImport } = await import("tsx/esm/api");
    return (await tsImport(configPath, import.meta.url)) as WorkspaceConfigModule;
  }

  const url = await runCliEffect(
    Effect.gen(function* () {
      const path = yield* Path.Path;
      return yield* path.toFileUrl(configPath);
    }),
  );
  return (await import(url.href)) as WorkspaceConfigModule;
}

function isTypeScriptPath(path: string): boolean {
  return /\.(?:c|m)?tsx?$/.test(path);
}

function resolveActiveFile(
  files: readonly SourceFile[],
  activeFile: string | null | undefined,
): SourceFile | null {
  if (!activeFile) return files[0] ?? null;

  const normalized = normalizeWorkspacePath(activeFile);
  return files.find((file) => file.path === normalized) ?? files[0] ?? null;
}

export function resolveWorkspacePath(directory: string, path: string): string {
  return Effect.runSync(
    Effect.gen(function* () {
      const pathService = yield* Path.Path;
      return pathService.isAbsolute(path) ? path : pathService.resolve(directory, path);
    }).pipe(Effect.provide(NodePath.layer)),
  );
}

function resolveCliPath(path: string): Promise<string> {
  return runCliEffect(
    Effect.gen(function* () {
      const pathService = yield* Path.Path;
      return pathService.resolve(path);
    }),
  );
}

function runCliEffect<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) {
  return Effect.runPromise(effect.pipe(Effect.provide(NodeCliLayer)));
}

async function resolveCliWorkspace(
  options: ParsedCliOptions,
  cliOptions: SchemaIdeCliOptions,
): Promise<SchemaIdeCliWorkspace | null> {
  if (options.schemaPath) {
    return loadSchemaIdeWorkspaceConfig(options.schemaPath);
  }

  if (cliOptions.schemaPath) {
    return loadSchemaIdeWorkspaceConfig(cliOptions.schemaPath);
  }

  return cliOptions.workspace ?? null;
}

function parseArgs(
  argv: readonly string[],
  defaultCommand: ParsedCliOptions["command"],
): ParsedCliOptions {
  const args = [...argv];
  const first = args[0];
  const command = isCommand(first) ? first : defaultCommand;
  const rest = command === first ? args.slice(1) : args;
  let schemaPath: string | null = null;
  let directory = ".";
  let json = false;
  let activeFile: string | null = null;
  let schemaId: string | null = null;
  let port: number | null = null;
  let staticDir: string | null = null;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === undefined) continue;

    if (arg === "--help" || arg === "-h") {
      return {
        command: "help",
        schemaPath,
        directory,
        json,
        activeFile,
        schemaId,
        port,
        staticDir,
      };
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--schema" || arg === "-s") {
      schemaPath = requireValue(rest, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--dir" || arg === "-d") {
      directory = requireValue(rest, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--active-file") {
      activeFile = requireValue(rest, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--schema-id") {
      schemaId = requireValue(rest, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--port" || arg === "-p") {
      port = Number(requireValue(rest, index, arg));
      if (!Number.isInteger(port) || port < 0) throw new Error(`Invalid port: ${port}`);
      index += 1;
      continue;
    }

    if (arg === "--static-dir") {
      staticDir = requireValue(rest, index, arg);
      index += 1;
      continue;
    }

    if (!arg.startsWith("-")) {
      directory = arg;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return { command, schemaPath, directory, json, activeFile, schemaId, port, staticDir };
}

function isCommand(value: string | undefined): value is ParsedCliOptions["command"] {
  return (
    value === "validate" ||
    value === "routes" ||
    value === "schema" ||
    value === "inspect" ||
    value === "serve" ||
    value === "web" ||
    value === "help"
  );
}

function isServeCommand(command: ParsedCliOptions["command"]): command is "serve" | "web" {
  return command === "serve" || command === "web";
}

function resolveDefaultStaticDir(): string | undefined {
  const candidates = [
    resolve(process.cwd(), "apps/playground/dist"),
    ...resolveModuleDefaultStaticDirCandidates(),
  ];

  return candidates.find((candidate) => existsSync(resolve(candidate, "index.html")));
}

function resolveModuleDefaultStaticDirCandidates(): readonly string[] {
  if (!import.meta.url) return [];

  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    return [resolve(moduleDir, "../../../apps/playground/dist")];
  } catch {
    return [];
  }
}

function requireValue(args: readonly string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function formatValidation(reflection: SchemaIdeReflection): string {
  const lines = [
    reflection.validationSummary.valid
      ? "Schema IDE validation passed."
      : "Schema IDE validation failed.",
    `errors=${reflection.validationSummary.errorCount} warnings=${reflection.validationSummary.warningCount} info=${reflection.validationSummary.infoCount}`,
  ];

  for (const diagnostic of reflection.diagnostics) {
    lines.push(formatDiagnostic(diagnostic));
  }

  return `${lines.join("\n")}\n`;
}

function formatDiagnostic(diagnostic: SchemaIdeDiagnostic): string {
  const path = diagnostic.path ?? diagnostic.documentPath ?? "(workspace)";
  const location =
    diagnostic.line && diagnostic.column
      ? `${path}:${diagnostic.line}:${diagnostic.column}`
      : diagnostic.line
        ? `${path}:${diagnostic.line}`
        : path;

  return `${diagnostic.severity} ${location} [${diagnostic.source}] ${diagnostic.message}`;
}

function formatRoutes(reflection: SchemaIdeReflection): string {
  const lines = reflection.routeMatches.map((route) => {
    const schemaId = route.schemaId ?? "(unmatched)";
    return `${route.path}\t${schemaId}\t${route.format}`;
  });
  return `${lines.join("\n")}${lines.length ? "\n" : ""}`;
}

function selectSchema(
  schemas: readonly ReflectedSchema[],
  schemaId: string | null,
): ReflectedSchema | null {
  if (schemaId) {
    return schemas.find((schema) => schema.id === schemaId) ?? null;
  }

  return schemas[0] ?? null;
}

function summarizeReflection(reflection: SchemaIdeReflection) {
  return {
    mode: reflection.mode,
    activeFile: reflection.activeFile,
    activeFormat: reflection.activeFormat,
    files: reflection.files.map((file) => file.path),
    summary: reflection.validationSummary,
    diagnostics: reflection.diagnostics,
    routeMatches: reflection.routeMatches,
    schemas: reflection.schemas,
  };
}

function helpText(options: SchemaIdeCliOptions): string {
  const name = options.name ?? "schema-ide";
  const schemaOption =
    options.workspace || options.schemaPath ? " [--schema <path>]" : " --schema <path>";

  return `Usage: ${name} <command>${schemaOption} [--dir <path>] [--json]

Commands:
  serve      Start a local Schema IDE UI for a workspace directory.
  web        Alias for serve.
  validate   Validate a local directory and print diagnostics.
  routes     Print file-to-schema route matches.
  schema     Print reflected JSON Schema. Use --schema-id for a route.
  inspect    Print files, summary, diagnostics, routes, and schemas as JSON.

Options:
  -s, --schema <path>      Consumer workspace config module. Optional when the CLI embeds a workspace.
  -d, --dir <path>         Directory to validate. Defaults to current directory.
  -p, --port <port>        Port for the serve command. Defaults to 4318.
      --static-dir <path>  Built Schema IDE UI directory to serve at /.
      --active-file <path> Active file used for document-mode schemas.
      --schema-id <id>     Schema route id for the schema command.
      --json               Print machine-readable JSON where supported.
  -h, --help               Show this help.
`;
}
