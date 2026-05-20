import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createReflection,
  formatForPath,
  validateSchemaIdeValue,
  type ReflectedSchema,
  type SchemaIdeDocumentFormat,
  type SchemaIdeDiagnostic,
  type SchemaIdeInputSchema,
  type SchemaIdeReflection,
  type SourceFile,
  type WorkspaceRouteMap,
} from "@schema-ide/core";

export const defaultCliInclude = ["**/*.json", "**/*.yaml", "**/*.yml", "**/*.pdf"] as const;
export const defaultCliExclude = [".git/**", "node_modules/**", "dist/**", "coverage/**"] as const;

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
}

export interface EmbeddedSchemaIdeCliOptions<
  A = unknown,
  Routes extends WorkspaceRouteMap = WorkspaceRouteMap,
> {
  readonly name?: string | undefined;
  readonly workspace: SchemaIdeCliWorkspace<A, Routes>;
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
  readonly command: "validate" | "routes" | "schema" | "inspect" | "help";
  readonly schemaPath: string | null;
  readonly directory: string;
  readonly json: boolean;
  readonly activeFile: string | null;
  readonly schemaId: string | null;
}

export function defineSchemaIdeWorkspace<A, Routes extends WorkspaceRouteMap = WorkspaceRouteMap>(
  workspace: SchemaIdeCliWorkspace<A, Routes>,
): SchemaIdeCliWorkspace<A, Routes> {
  return workspace;
}

export function createSchemaIdeCli(options: SchemaIdeCliOptions = {}): SchemaIdeCli {
  return {
    run: (argv) => runSchemaIdeCli(argv, options),
    main: (argv) => writeCliResult(() => runSchemaIdeCli(argv ?? process.argv.slice(2), options)),
  };
}

export function createEmbeddedSchemaIdeCli(options: EmbeddedSchemaIdeCliOptions): SchemaIdeCli {
  return {
    run: (argv) => runEmbeddedSchemaIdeCli(argv, options),
    main: (argv) =>
      writeCliResult(() => runEmbeddedSchemaIdeCli(argv ?? process.argv.slice(2), options)),
  };
}

export async function runSchemaIdeCli(
  argv: readonly string[],
  cliOptions: SchemaIdeCliOptions = {},
): Promise<SchemaIdeCliResult> {
  const options = parseArgs(argv);

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
  const options = parseArgs(argv);

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
  const resolvedPath = resolve(configPath);
  const module = await importConfigModule(resolvedPath);
  const workspace = module.default ?? module.workspace;

  if (!workspace || typeof workspace !== "object" || !("schema" in workspace)) {
    throw new Error(
      `Schema IDE config must export a workspace definition as default or named "workspace": ${configPath}`,
    );
  }

  return workspace as SchemaIdeCliWorkspace;
}

export async function readSourceFilesFromDirectory({
  directory,
  include = defaultCliInclude,
  exclude = defaultCliExclude,
}: ReadSourceFilesOptions): Promise<readonly SourceFile[]> {
  const root = resolve(directory);
  const rootStat = await stat(root);

  if (!rootStat.isDirectory()) {
    throw new Error(`Workspace directory is not a directory: ${directory}`);
  }

  const files: SourceFile[] = [];
  await collectSourceFiles(root, root, include, exclude, files);
  return files.sort((left, right) => left.path.localeCompare(right.path));
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

async function collectSourceFiles(
  root: string,
  directory: string,
  include: readonly string[],
  exclude: readonly string[],
  files: SourceFile[],
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    const path = normalizeWorkspacePath(relative(root, absolutePath));

    if (matchesAny(path, exclude)) {
      continue;
    }

    if (entry.isDirectory()) {
      await collectSourceFiles(root, absolutePath, include, exclude, files);
      continue;
    }

    if (!entry.isFile() || !matchesAny(path, include)) {
      continue;
    }

    files.push({
      path,
      content: await readFile(absolutePath, "utf8"),
    });
  }
}

async function importConfigModule(configPath: string): Promise<WorkspaceConfigModule> {
  if (isTypeScriptPath(configPath)) {
    const { tsImport } = await import("tsx/esm/api");
    return (await tsImport(configPath, import.meta.url)) as WorkspaceConfigModule;
  }

  const url = pathToFileURL(configPath).href;
  return (await import(url)) as WorkspaceConfigModule;
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

function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchGlob(pattern, path));
}

function matchGlob(pattern: string, path: string): boolean {
  return globToRegExp(normalizeWorkspacePath(pattern)).test(normalizeWorkspacePath(path));
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

function normalizeWorkspacePath(path: string): string {
  const normalized = path.split(sep).join("/");
  return normalized.replace(/^\.\//, "").replace(/^\/+/, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function resolveWorkspacePath(directory: string, path: string): string {
  return isAbsolute(path) ? path : resolve(directory, path);
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

function parseArgs(argv: readonly string[]): ParsedCliOptions {
  const args = [...argv];
  const first = args[0];
  const command = isCommand(first) ? first : "validate";
  const rest = command === first ? args.slice(1) : args;
  let schemaPath: string | null = null;
  let directory = ".";
  let json = false;
  let activeFile: string | null = null;
  let schemaId: string | null = null;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === undefined) continue;

    if (arg === "--help" || arg === "-h") {
      return { command: "help", schemaPath, directory, json, activeFile, schemaId };
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

    if (!arg.startsWith("-")) {
      directory = arg;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return { command, schemaPath, directory, json, activeFile, schemaId };
}

function isCommand(value: string | undefined): value is ParsedCliOptions["command"] {
  return (
    value === "validate" ||
    value === "routes" ||
    value === "schema" ||
    value === "inspect" ||
    value === "help"
  );
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
  validate   Validate a local directory and print diagnostics.
  routes     Print file-to-schema route matches.
  schema     Print reflected JSON Schema. Use --schema-id for a route.
  inspect    Print files, summary, diagnostics, routes, and schemas as JSON.

Options:
  -s, --schema <path>      Consumer workspace config module. Optional when the CLI embeds a workspace.
  -d, --dir <path>         Directory to validate. Defaults to current directory.
      --active-file <path> Active file used for document-mode schemas.
      --schema-id <id>     Schema route id for the schema command.
      --json               Print machine-readable JSON where supported.
  -h, --help               Show this help.
`;
}
