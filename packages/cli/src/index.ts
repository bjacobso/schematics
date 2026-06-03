import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Path } from "effect";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ArtifactProject,
  SchemaIdeArtifactProject,
  createSchemaIdeArtifactRuntime,
  Project,
  formatForPath,
  isProjectSchema,
  type AnySchema,
  type CreateSchemaIdeArtifactRuntimeOptions,
  type ReflectedSchema,
  type SchemaIdeDocumentFormat,
  type SchemaIdeDiagnostic,
  type SchemaIdeInputSchema,
  type SchemaIdeReflection,
  type SourceFile,
  type ProjectRouteMap,
} from "@schema-ide/core";
import { ArtifactRef, type ArtifactProjectDeclaration } from "@schema-ide/artifacts";
import {
  runSchemaIdeHttpServer,
  type SchemaIdeNodeServerHandle,
  type SchemaIdeStaticAssets,
} from "@schema-ide/server";
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

export type SchemaIdeCliArtifactProject = ArtifactProjectDeclaration<string, any, any>;

export interface SchemaIdeCliProjectConfig<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
> {
  readonly id?: string | undefined;
  readonly schema: SchemaIdeInputSchema<A, Routes>;
  readonly artifactProject?: SchemaIdeCliArtifactProject | undefined;
  readonly relationInputSchema?: SchemaIdeInputSchema<any> | undefined;
  readonly relationSchema?: AnySchema | undefined;
  readonly relationValue?: ((value: any) => unknown) | undefined;
  readonly projectDiagnostics?:
    | CreateSchemaIdeArtifactRuntimeOptions<A>["projectDiagnostics"]
    | undefined;
  readonly defaultFormat?: SchemaIdeDocumentFormat | undefined;
  readonly include?: readonly string[] | undefined;
  readonly exclude?: readonly string[] | undefined;
}

export interface SchemaIdeCliProjectDefinition<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
> {
  readonly id?: string | undefined;
  readonly project: ArtifactProjectDeclaration<string, any, any>;
  readonly schema?: SchemaIdeInputSchema<A, Routes> | undefined;
  readonly relationInputSchema?: SchemaIdeInputSchema<any> | undefined;
  readonly relationSchema?: AnySchema | undefined;
  readonly relationValue?: ((value: any) => unknown) | undefined;
  readonly projectDiagnostics?:
    | CreateSchemaIdeArtifactRuntimeOptions<A>["projectDiagnostics"]
    | undefined;
  readonly defaultFormat?: SchemaIdeDocumentFormat | undefined;
  readonly include?: readonly string[] | undefined;
  readonly exclude?: readonly string[] | undefined;
}

type AnySchemaIdeCliProjectConfig = SchemaIdeCliProjectConfig<any, any>;

export interface ReadSourceFilesOptions {
  readonly directory: string;
  readonly include?: readonly string[] | undefined;
  readonly exclude?: readonly string[] | undefined;
}

export interface ValidateProjectDirectoryOptions<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
> {
  readonly project: SchemaIdeCliProjectConfig<A, Routes>;
  readonly directory: string;
  readonly activeFile?: string | null | undefined;
}

export interface ProjectConfigModule<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
> {
  readonly default?:
    | SchemaIdeCliProjectConfig<A, Routes>
    | SchemaIdeCliProjectDefinition<A, Routes>
    | undefined;
  readonly project?: SchemaIdeCliProjectDefinition<A, Routes> | undefined;
}

export interface SchemaIdeCliOptions<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
> {
  readonly name?: string | undefined;
  readonly project?: SchemaIdeCliProjectConfig<A, Routes> | undefined;
  readonly schemaPath?: string | undefined;
  readonly staticAssets?: SchemaIdeStaticAssets | undefined;
}

export interface EmbeddedSchemaIdeCliOptions<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
> {
  readonly name?: string | undefined;
  readonly project: SchemaIdeCliProjectConfig<A, Routes>;
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

export interface SchemaIdeProjectServeOptions {
  readonly project: AnySchemaIdeCliProjectConfig;
  readonly directory: string;
  readonly port?: number | undefined;
  readonly staticDir?: string | undefined;
  readonly staticAssets?: SchemaIdeStaticAssets | undefined;
  readonly openRouterApiKey?: string | undefined;
  readonly artifactProjectRpcProtocol?: "http" | "websocket" | undefined;
}

export function defineSchemaIdeProject<A, Routes extends ProjectRouteMap = ProjectRouteMap>(
  project: SchemaIdeCliProjectDefinition<A, Routes>,
): SchemaIdeCliProjectConfig<A, Routes> {
  return normalizeProjectDefinition(project);
}

export function createSchemaIdeCli(options: SchemaIdeCliOptions = {}): SchemaIdeCli {
  return {
    run: (argv) => runSchemaIdeCli(argv, options),
    main: (argv) => runSchemaIdeCliMain(argv ?? process.argv.slice(2), options),
  };
}

export function createEmbeddedSchemaIdeCli<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
>(options: EmbeddedSchemaIdeCliOptions<A, Routes>): SchemaIdeCli {
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

  const project = await resolveCliProject(options, cliOptions);
  if (!project) {
    return {
      exitCode: 2,
      stdout: "",
      stderr: `Missing required --schema <path> option.\n\n${helpText(cliOptions)}`,
    };
  }

  return runSchemaIdeCliCommand(options, project);
}

async function runSchemaIdeCliCommand(
  options: ParsedCliOptions,
  project: AnySchemaIdeCliProjectConfig,
): Promise<SchemaIdeCliResult> {
  if (isServeCommand(options.command)) {
    return {
      exitCode: 0,
      stdout: `Starting local Schema IDE UI for ${options.directory}.\n`,
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

async function runEmbeddedSchemaIdeCli<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
>(
  argv: readonly string[],
  cliOptions: EmbeddedSchemaIdeCliOptions<A, Routes>,
): Promise<SchemaIdeCliResult> {
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

  return runSchemaIdeCliCommand(options, withArtifactProject(cliOptions.project));
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
    const project = await resolveCliProject(options, cliOptions);
    if (!project) {
      process.stderr.write(`Missing required --schema <path> option.\n\n${helpText(cliOptions)}`);
      process.exitCode = 2;
      return;
    }
    await runServeMain(project, options, cliOptions);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

async function runEmbeddedSchemaIdeCliMain<
  A = unknown,
  Routes extends ProjectRouteMap = ProjectRouteMap,
>(argv: readonly string[], cliOptions: EmbeddedSchemaIdeCliOptions<A, Routes>): Promise<void> {
  const options = parseArgs(argv, "serve");
  if (!isServeCommand(options.command)) {
    await writeCliResult(() => runEmbeddedSchemaIdeCli(argv, cliOptions));
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
    await runServeMain(withArtifactProject(cliOptions.project), options, cliOptions);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

async function runServeMain(
  project: AnySchemaIdeCliProjectConfig,
  options: ParsedCliOptions,
  cliOptions: Pick<SchemaIdeCliOptions<any, any>, "staticAssets">,
): Promise<void> {
  const staticDir = options.staticDir ?? resolveDefaultStaticDir();
  const staticAssets = staticDir ? undefined : cliOptions.staticAssets;
  const server = await serveSchemaIdeProject({
    project,
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

export async function loadSchemaIdeProjectConfig(
  configPath: string,
): Promise<SchemaIdeCliProjectConfig> {
  const resolvedPath = await resolveCliPath(configPath);
  const module = await importConfigModule(resolvedPath);
  const config = module.default ?? module.project;

  if (!config || typeof config !== "object" || (!("schema" in config) && !("project" in config))) {
    throw new Error(`Schema IDE config must export an artifact project definition: ${configPath}`);
  }

  return isProjectConfig(config)
    ? normalizeProjectDefinition(config)
    : withArtifactProject(config as SchemaIdeCliProjectConfig);
}

export async function serveSchemaIdeProject({
  project,
  directory,
  port = 4318,
  staticDir = process.env["SCHEMA_IDE_STATIC_DIR"],
  staticAssets,
  openRouterApiKey = process.env["OPENROUTER_API_KEY"] ??
    process.env["SCHEMA_IDE_OPENROUTER_API_KEY"],
  artifactProjectRpcProtocol,
}: SchemaIdeProjectServeOptions): Promise<SchemaIdeNodeServerHandle> {
  const artifactProjectService = createLocalFilesystemArtifactProjectClient({
    project,
    directory,
    agentEnabled: Boolean(openRouterApiKey),
  });
  const server = await runSchemaIdeHttpServer({
    port,
    staticDir,
    staticAssets: staticDir ? undefined : staticAssets,
    openRouterApiKey,
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
}: ValidateProjectDirectoryOptions<A, Routes>): Promise<SchemaIdeReflection> {
  const files = await readSourceFilesFromDirectory({
    directory,
    include: project.include,
    exclude: project.exclude,
  });
  const selectedFile = resolveActiveFile(files, activeFile);
  const activeFormat = selectedFile
    ? formatForPath(selectedFile.path, project.defaultFormat ?? "json")
    : (project.defaultFormat ?? "json");
  const runtime = createSchemaIdeArtifactRuntime({
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
    ) as Effect.Effect<SchemaIdeReflection>,
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
  cliOptions: SchemaIdeCliOptions,
): Promise<SchemaIdeCliProjectConfig | null> {
  if (options.schemaPath) {
    return loadSchemaIdeProjectConfig(options.schemaPath);
  }

  if (cliOptions.schemaPath) {
    return loadSchemaIdeProjectConfig(cliOptions.schemaPath);
  }

  return cliOptions.project ? withArtifactProject(cliOptions.project) : null;
}

function withArtifactProject<A, Routes extends ProjectRouteMap = ProjectRouteMap>(
  project: SchemaIdeCliProjectConfig<A, Routes>,
): SchemaIdeCliProjectConfig<A, Routes> {
  if (project.artifactProject) return project;

  return {
    ...project,
    artifactProject: isProjectSchema(project.schema)
      ? ArtifactProject.fromProjectSchema(project.schema, {
          name: project.id ?? "schema-ide",
        })
      : SchemaIdeArtifactProject,
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
}: SchemaIdeCliProjectDefinition<A, Routes>): SchemaIdeCliProjectConfig<A, Routes> {
  return {
    id: id ?? project.name,
    schema:
      schema ??
      (Project.fromArtifactProject(project) as unknown as SchemaIdeInputSchema<A, Routes>),
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

function isProjectConfig(value: unknown): value is SchemaIdeCliProjectDefinition {
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
  const path = diagnostic.path ?? diagnostic.documentPath ?? "(project)";
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

function helpText(options: SchemaIdeCliOptions<any, any>): string {
  const name = options.name ?? "schema-ide";
  const schemaOption =
    options.project || options.schemaPath ? " [--schema <path>]" : " --schema <path>";

  return `Usage: ${name} <command>${schemaOption} [--dir <path>] [--json]

Commands:
  serve      Start a local Schema IDE UI for a project directory.
  web        Alias for serve.
  validate   Validate a local directory and print diagnostics.
  routes     Print file-to-schema route matches.
  schema     Print reflected JSON Schema. Use --schema-id for a route.
  inspect    Print files, summary, diagnostics, routes, and schemas as JSON.

Options:
  -s, --schema <path>      Artifact project config module.
  -d, --dir <path>         Directory to validate. Defaults to current directory.
  -p, --port <port>        Port for the serve command. Defaults to 4318.
      --static-dir <path>  Built Schema IDE UI directory to serve at /.
      --active-file <path> Active file used for document-mode schemas.
      --schema-id <id>     Schema route id for the schema command.
      --json               Print machine-readable JSON where supported.
  -h, --help               Show this help.
`;
}
