import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Path } from "effect";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ArtifactProject,
  SchematicsArtifactProject,
  createSchematicsArtifactRuntime,
  Project,
  formatForPath,
  isProjectSchema,
  type AnySchema,
  type CreateSchematicsArtifactRuntimeOptions,
  type ReflectedSchema,
  type SchematicsDocumentFormat,
  type SchematicsDiagnostic,
  type SchematicsInputSchema,
  type SchematicsReflection,
  type SourceFile,
  type ProjectRouteMap,
} from "@schematics/core";
import { ArtifactRef, type ArtifactProjectDeclaration } from "@schematics/artifacts";
import { fixedClockFromIso } from "@schematics/git-artifacts";
import {
  runSchematicsHttpServer,
  type SchematicsNodeServerHandle,
  type SchematicsStaticAssets,
} from "@schematics/server";
import {
  createLocalFilesystemArtifactProjectClient,
  resolveSafeWorkspacePath,
  type LocalFilesystemArtifactProject,
  type LocalFilesystemArtifactProjectClientOptions,
} from "./local-artifact-project-client";
import { matchesAny, normalizeWorkspacePath } from "./glob";

const NodeCliLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer);

export {
  createLocalFilesystemArtifactProjectClient,
  resolveSafeWorkspacePath,
  type LocalFilesystemArtifactProject,
  type LocalFilesystemArtifactProjectClientOptions,
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
export const defaultCliExclude = [".git/**", "node_modules/**", "dist/**", "coverage/**"] as const;

export type SchematicsCliArtifactProject = ArtifactProjectDeclaration<string, any, any>;

export interface SchematicsCliProjectConfig<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
> {
  readonly id?: string | undefined;
  readonly schema: SchematicsInputSchema<A, Routes>;
  readonly artifactProject?: SchematicsCliArtifactProject | undefined;
  readonly relationInputSchema?: SchematicsInputSchema<any> | undefined;
  readonly relationSchema?: AnySchema | undefined;
  readonly relationValue?: ((value: any) => unknown) | undefined;
  readonly projectDiagnostics?:
    | CreateSchematicsArtifactRuntimeOptions<A>["projectDiagnostics"]
    | undefined;
  readonly defaultFormat?: SchematicsDocumentFormat | undefined;
  readonly include?: readonly string[] | undefined;
  readonly exclude?: readonly string[] | undefined;
}

export interface SchematicsCliProjectDefinition<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
> {
  readonly id?: string | undefined;
  readonly project: ArtifactProjectDeclaration<string, any, any>;
  readonly schema?: SchematicsInputSchema<A, Routes> | undefined;
  readonly relationInputSchema?: SchematicsInputSchema<any> | undefined;
  readonly relationSchema?: AnySchema | undefined;
  readonly relationValue?: ((value: any) => unknown) | undefined;
  readonly projectDiagnostics?:
    | CreateSchematicsArtifactRuntimeOptions<A>["projectDiagnostics"]
    | undefined;
  readonly defaultFormat?: SchematicsDocumentFormat | undefined;
  readonly include?: readonly string[] | undefined;
  readonly exclude?: readonly string[] | undefined;
}

type AnySchematicsCliProjectConfig = SchematicsCliProjectConfig<any, any>;

export interface ReadSourceFilesOptions {
  readonly directory: string;
  readonly include?: readonly string[] | undefined;
  readonly exclude?: readonly string[] | undefined;
}

export interface ValidateProjectDirectoryOptions<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
> {
  readonly project: SchematicsCliProjectConfig<A, Routes>;
  readonly directory: string;
  readonly activeFile?: string | null | undefined;
}

export interface ProjectConfigModule<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
> {
  readonly default?:
    | SchematicsCliProjectConfig<A, Routes>
    | SchematicsCliProjectDefinition<A, Routes>
    | undefined;
  readonly project?: SchematicsCliProjectDefinition<A, Routes> | undefined;
}

export interface SchematicsCliOptions<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
> {
  readonly name?: string | undefined;
  readonly project?: SchematicsCliProjectConfig<A, Routes> | undefined;
  readonly schemaPath?: string | undefined;
  readonly staticAssets?: SchematicsStaticAssets | undefined;
}

export interface EmbeddedSchematicsCliOptions<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
> {
  readonly name?: string | undefined;
  readonly project: SchematicsCliProjectConfig<A, Routes>;
  readonly staticAssets?: SchematicsStaticAssets | undefined;
}

export interface SchematicsCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface SchematicsCli {
  readonly run: (argv: readonly string[]) => Promise<SchematicsCliResult>;
  readonly main: (argv?: readonly string[]) => Promise<void>;
}

interface ParsedCliOptions {
  readonly command: "validate" | "routes" | "schema" | "inspect" | "serve" | "web" | "ide" | "help";
  readonly schemaPath: string | null;
  readonly directory: string;
  readonly json: boolean;
  readonly activeFile: string | null;
  readonly schemaId: string | null;
  readonly port: number | null;
  readonly staticDir: string | null;
  readonly history: boolean;
}

type ServeCommand = "serve" | "web" | "ide";

export interface SchematicsProjectServeOptions {
  readonly project: AnySchematicsCliProjectConfig;
  readonly directory: string;
  readonly port?: number | undefined;
  readonly staticDir?: string | undefined;
  readonly staticAssets?: SchematicsStaticAssets | undefined;
  readonly openRouterApiKey?: string | undefined;
  readonly artifactProjectRpcProtocol?: "http" | "websocket" | undefined;
  /**
   * When `false`, UI edits persist to disk but are never committed to git, even
   * if the served directory is inside a git repo. Defaults to `true` (or `false`
   * when `SCHEMATICS_NO_HISTORY=1`).
   */
  readonly history?: boolean | undefined;
}

export function defineSchematicsProject<A, Routes extends ProjectRouteMap = ProjectRouteMap>(
  project: SchematicsCliProjectDefinition<A, Routes>,
): SchematicsCliProjectConfig<A, Routes> {
  return normalizeProjectDefinition(project);
}

export function createSchematicsCli(options: SchematicsCliOptions = {}): SchematicsCli {
  return {
    run: (argv) => runSchematicsCli(argv, options),
    main: (argv) => runSchematicsCliMain(argv ?? process.argv.slice(2), options),
  };
}

export function createEmbeddedSchematicsCli<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
>(options: EmbeddedSchematicsCliOptions<A, Routes>): SchematicsCli {
  return {
    run: (argv) => runEmbeddedSchematicsCli(argv, options),
    main: (argv) => runEmbeddedSchematicsCliMain(argv ?? process.argv.slice(2), options),
  };
}

export async function runSchematicsCli(
  argv: readonly string[],
  cliOptions: SchematicsCliOptions = {},
): Promise<SchematicsCliResult> {
  const options = parseArgs(argv, "validate");

  if (options.command === "help") {
    return { exitCode: 0, stdout: helpText(cliOptions), stderr: "" };
  }

  const project = await resolveCliProject(options, cliOptions);
  if (!project) {
    return {
      exitCode: 2,
      stdout: "",
      stderr: `Missing required --schema <path> option.\n\n${helpText(cliOptions)}`,
    };
  }

  return runSchematicsCliCommand(options, project);
}

async function runSchematicsCliCommand(
  options: ParsedCliOptions,
  project: AnySchematicsCliProjectConfig,
): Promise<SchematicsCliResult> {
  if (isServeCommand(options.command)) {
    return {
      exitCode: 0,
      stdout: `Starting local Schematics ${options.command === "ide" ? "IDE" : "UI"} for ${options.directory}.\n`,
      stderr: "",
    };
  }

  const reflection = await validateProjectDirectory({
    project,
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

async function runEmbeddedSchematicsCli<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
>(
  argv: readonly string[],
  cliOptions: EmbeddedSchematicsCliOptions<A, Routes>,
): Promise<SchematicsCliResult> {
  const options = parseArgs(argv, "serve");

  if (options.command === "help") {
    return { exitCode: 0, stdout: helpText(cliOptions), stderr: "" };
  }

  if (options.schemaPath) {
    return {
      exitCode: 2,
      stdout: "",
      stderr: `This CLI embeds its artifact project and does not accept --schema.\n\n${helpText(
        cliOptions,
      )}`,
    };
  }

  return runSchematicsCliCommand(options, withArtifactProject(cliOptions.project));
}

async function runSchematicsCliMain(
  argv: readonly string[],
  cliOptions: SchematicsCliOptions,
): Promise<void> {
  const options = parseArgs(argv, "validate");
  if (!isServeCommand(options.command)) {
    await writeCliResult(() => runSchematicsCli(argv, cliOptions));
    return;
  }

  try {
    const project = await resolveCliProject(options, cliOptions);
    if (!project) {
      process.stderr.write(`Missing required --schema <path> option.\n\n${helpText(cliOptions)}`);
      process.exitCode = 2;
      return;
    }
    await runServeMain(project, { ...options, command: options.command }, cliOptions);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

async function runEmbeddedSchematicsCliMain<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
>(argv: readonly string[], cliOptions: EmbeddedSchematicsCliOptions<A, Routes>): Promise<void> {
  const options = parseArgs(argv, "serve");
  if (!isServeCommand(options.command)) {
    await writeCliResult(() => runEmbeddedSchematicsCli(argv, cliOptions));
    return;
  }

  if (options.schemaPath) {
    process.stderr.write(
      `This CLI embeds its artifact project and does not accept --schema.\n\n${helpText(
        cliOptions,
      )}`,
    );
    process.exitCode = 2;
    return;
  }

  try {
    await runServeMain(
      withArtifactProject(cliOptions.project),
      { ...options, command: options.command },
      cliOptions,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

async function runServeMain(
  project: AnySchematicsCliProjectConfig,
  options: ParsedCliOptions & { readonly command: ServeCommand },
  cliOptions: Pick<SchematicsCliOptions<any, any>, "staticAssets">,
): Promise<void> {
  const staticDir = options.staticDir ?? resolveDefaultStaticDir(options.command);
  const staticAssets = staticDir ? undefined : cliOptions.staticAssets;
  // Either the --no-history flag or SCHEMATICS_NO_HISTORY=1 disables auto-commit.
  const history = options.history && process.env["SCHEMATICS_NO_HISTORY"] !== "1";
  const server = await serveSchematicsProject({
    project,
    directory: options.directory,
    port: options.port ?? 4318,
    staticDir,
    staticAssets,
    history,
  });
  process.stdout.write(`Schematics listening on http://127.0.0.1:${server.port}/\n`);
  if (!staticDir && !staticAssets && !process.env["SCHEMATICS_STATIC_DIR"]) {
    process.stdout.write(
      `No Schematics ${options.command === "ide" ? "IDE" : "UI"} bundle was found. Build ${
        options.command === "ide" ? "apps/ide" : "the playground"
      } or pass --static-dir to serve /.\n`,
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

async function writeCliResult(run: () => Promise<SchematicsCliResult>): Promise<void> {
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

export async function loadSchematicsProjectConfig(
  configPath: string,
): Promise<SchematicsCliProjectConfig> {
  const resolvedPath = await resolveCliPath(configPath);
  const module = await importConfigModule(resolvedPath);
  const config = module.default ?? module.project;

  if (!config || typeof config !== "object" || (!("schema" in config) && !("project" in config))) {
    throw new Error(`Schematics config must export an artifact project definition: ${configPath}`);
  }

  return isProjectConfig(config)
    ? normalizeProjectDefinition(config)
    : withArtifactProject(config as SchematicsCliProjectConfig);
}

export async function serveSchematicsProject({
  project,
  directory,
  port = 4318,
  staticDir = process.env["SCHEMATICS_STATIC_DIR"],
  staticAssets,
  openRouterApiKey = process.env["OPENROUTER_API_KEY"] ??
    process.env["SCHEMATICS_OPENROUTER_API_KEY"],
  artifactProjectRpcProtocol,
  history = process.env["SCHEMATICS_NO_HISTORY"] === "1" ? false : true,
}: SchematicsProjectServeOptions): Promise<SchematicsNodeServerHandle> {
  const scriptedAgentEdit = process.env["SCHEMATICS_E2E_SCRIPTED_AGENT"] === "1";
  const clock = fixedClockFromIso(process.env["E2E_NOW"]) ?? undefined;
  const artifactProjectService = createLocalFilesystemArtifactProjectClient({
    project,
    directory,
    agentEnabled: Boolean(openRouterApiKey || scriptedAgentEdit),
    clock,
    history,
  });
  const server = await runSchematicsHttpServer({
    port,
    staticDir,
    staticAssets: staticDir ? undefined : staticAssets,
    openRouterApiKey,
    debugChat: scriptedAgentEdit ? { scriptedAgentEdit } : undefined,
    artifactProject: artifactProjectService,
    artifactProjectRpcProtocol,
  });
  const closeServer = server.close;
  return {
    port: server.port,
    close: async () => {
      await Effect.runPromise(artifactProjectService.close);
      await closeServer();
    },
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
    }),
  );
}

export async function validateProjectDirectory<
  A,
  Routes extends ProjectRouteMap = ProjectRouteMap,
>({
  project,
  directory,
  activeFile,
}: ValidateProjectDirectoryOptions<A, Routes>): Promise<SchematicsReflection> {
  const files = await readSourceFilesFromDirectory({
    directory,
    include: project.include,
    exclude: project.exclude,
  });
  const selectedFile = resolveActiveFile(files, activeFile);
  const activeFormat = selectedFile
    ? formatForPath(selectedFile.path, project.defaultFormat ?? "json")
    : (project.defaultFormat ?? "json");
  const runtime = createSchematicsArtifactRuntime({
    schema: project.schema,
    files,
    activeFile: selectedFile?.path ?? null,
    activeFormat,
    ...(project.id ? { projectId: project.id } : {}),
    ...(project.artifactProject ? { project: project.artifactProject } : {}),
    ...(project.relationInputSchema ? { relationInputSchema: project.relationInputSchema } : {}),
    ...(project.relationSchema ? { relationSchema: project.relationSchema } : {}),
    ...(project.relationValue ? { relationValue: project.relationValue } : {}),
    ...(project.projectDiagnostics ? { projectDiagnostics: project.projectDiagnostics } : {}),
  });

  return Effect.runPromise(
    runtime.view(
      ArtifactRef.project(project.id),
      "reflection",
    ) as Effect.Effect<SchematicsReflection>,
  );
}

function isBinaryWorkspacePath(path: string): boolean {
  return /\.(?:pdf|png|jpe?g|webp)$/i.test(path);
}

async function importConfigModule(configPath: string): Promise<ProjectConfigModule> {
  if (isTypeScriptPath(configPath)) {
    const { tsImport } = await import("tsx/esm/api");
    return (await tsImport(configPath, import.meta.url)) as ProjectConfigModule;
  }

  const url = await runCliEffect(
    Effect.gen(function* () {
      const path = yield* Path.Path;
      return yield* path.toFileUrl(configPath);
    }),
  );
  return (await import(url.href)) as ProjectConfigModule;
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

async function resolveCliProject(
  options: ParsedCliOptions,
  cliOptions: SchematicsCliOptions,
): Promise<SchematicsCliProjectConfig | null> {
  if (options.schemaPath) {
    return loadSchematicsProjectConfig(options.schemaPath);
  }

  if (cliOptions.schemaPath) {
    return loadSchematicsProjectConfig(cliOptions.schemaPath);
  }

  return cliOptions.project ? withArtifactProject(cliOptions.project) : null;
}

function withArtifactProject<A, Routes extends ProjectRouteMap = ProjectRouteMap>(
  project: SchematicsCliProjectConfig<A, Routes>,
): SchematicsCliProjectConfig<A, Routes> {
  if (project.artifactProject) return project;

  return {
    ...project,
    artifactProject: isProjectSchema(project.schema)
      ? ArtifactProject.fromProjectSchema(project.schema, {
          name: project.id ?? "schematics",
        })
      : SchematicsArtifactProject,
  };
}

function normalizeProjectDefinition<A, Routes extends ProjectRouteMap = ProjectRouteMap>({
  id,
  project,
  schema,
  relationInputSchema,
  relationSchema,
  relationValue,
  projectDiagnostics,
  defaultFormat,
  include,
  exclude,
}: SchematicsCliProjectDefinition<A, Routes>): SchematicsCliProjectConfig<A, Routes> {
  return {
    id: id ?? project.name,
    schema:
      schema ??
      (Project.fromArtifactProject(project) as unknown as SchematicsInputSchema<A, Routes>),
    artifactProject: project,
    ...(relationInputSchema ? { relationInputSchema } : {}),
    ...(relationSchema ? { relationSchema } : {}),
    ...(relationValue ? { relationValue } : {}),
    ...(projectDiagnostics ? { projectDiagnostics } : {}),
    ...(defaultFormat ? { defaultFormat } : {}),
    ...(include ? { include } : {}),
    ...(exclude ? { exclude } : {}),
  };
}

function isProjectConfig(value: unknown): value is SchematicsCliProjectDefinition {
  return Boolean(
    value &&
    typeof value === "object" &&
    "project" in value &&
    (value as { project?: { _tag?: unknown } }).project?._tag === "ArtifactProject",
  );
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
  let history = true;

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
        history,
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

    if (arg === "--no-history") {
      history = false;
      continue;
    }

    if (arg === "--history") {
      history = true;
      continue;
    }

    if (!arg.startsWith("-")) {
      directory = arg;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return { command, schemaPath, directory, json, activeFile, schemaId, port, staticDir, history };
}

function isCommand(value: string | undefined): value is ParsedCliOptions["command"] {
  return (
    value === "validate" ||
    value === "routes" ||
    value === "schema" ||
    value === "inspect" ||
    value === "serve" ||
    value === "web" ||
    value === "ide" ||
    value === "help"
  );
}

function isServeCommand(command: ParsedCliOptions["command"]): command is ServeCommand {
  return command === "serve" || command === "web" || command === "ide";
}

function resolveDefaultStaticDir(command: ServeCommand): string | undefined {
  const app = command === "ide" ? "ide" : "playground";
  const candidates = [
    resolve(process.cwd(), `apps/${app}/dist`),
    ...resolveModuleDefaultStaticDirCandidates(app),
  ];

  return candidates.find((candidate) => existsSync(resolve(candidate, "index.html")));
}

function resolveModuleDefaultStaticDirCandidates(app: "ide" | "playground"): readonly string[] {
  if (!import.meta.url) return [];

  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    return [resolve(moduleDir, `../../../apps/${app}/dist`)];
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

function formatValidation(reflection: SchematicsReflection): string {
  const lines = [
    reflection.validationSummary.valid
      ? "Schematics validation passed."
      : "Schematics validation failed.",
    `errors=${reflection.validationSummary.errorCount} warnings=${reflection.validationSummary.warningCount} info=${reflection.validationSummary.infoCount}`,
  ];

  for (const diagnostic of reflection.diagnostics) {
    lines.push(formatDiagnostic(diagnostic));
  }

  return `${lines.join("\n")}\n`;
}

function formatDiagnostic(diagnostic: SchematicsDiagnostic): string {
  const path = diagnostic.path ?? diagnostic.documentPath ?? "(project)";
  const location =
    diagnostic.line && diagnostic.column
      ? `${path}:${diagnostic.line}:${diagnostic.column}`
      : diagnostic.line
        ? `${path}:${diagnostic.line}`
        : path;

  return `${diagnostic.severity} ${location} [${diagnostic.source}] ${diagnostic.message}`;
}

function formatRoutes(reflection: SchematicsReflection): string {
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

function summarizeReflection(reflection: SchematicsReflection) {
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

function helpText(options: SchematicsCliOptions<any, any>): string {
  const name = options.name ?? "schematics";
  const schemaOption =
    options.project || options.schemaPath ? " [--schema <path>]" : " --schema <path>";

  return `Usage: ${name} <command>${schemaOption} [--dir <path>] [--json]

Commands:
  ide        Start a minimal local Schematics IDE for a project directory.
  serve      Start a local Schematics UI for a project directory.
  web        Alias for serve.
  validate   Validate a local directory and print diagnostics.
  routes     Print file-to-schema route matches.
  schema     Print reflected JSON Schema. Use --schema-id for a route.
  inspect    Print files, summary, diagnostics, routes, and schemas as JSON.

Options:
  -s, --schema <path>      Artifact project config module.
  -d, --dir <path>         Directory to validate. Defaults to current directory.
  -p, --port <port>        Port for the serve/ide command. Defaults to 4318.
      --static-dir <path>  Built Schematics UI directory to serve at /.
      --no-history         Serve in place without git auto-commit (edits persist
                           to disk uncommitted). Also via SCHEMATICS_NO_HISTORY=1.
      --active-file <path> Active file used for document-mode schemas.
      --schema-id <id>     Schema route id for the schema command.
      --json               Print machine-readable JSON where supported.
  -h, --help               Show this help.
`;
}
