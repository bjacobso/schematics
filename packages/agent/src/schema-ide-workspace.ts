import { Context, Effect, Layer } from "effect";
import type { SchemaIdeReflection, SourceFile } from "@schema-ide/core";
import type {
  SchemaIdeFileEdit,
  SchemaIdePatchProposal,
  SchemaIdeToolRuntime,
} from "./types";
import type { SchemaIdeToolFailure } from "./common-toolkit-schemas";

export interface SchemaIdeWorkspaceService {
  readonly readFile: (path: string) => Effect.Effect<SourceFile, SchemaIdeToolFailure>;
  readonly listFiles: Effect.Effect<readonly string[]>;
  readonly searchFiles: (
    query: string,
  ) => Effect.Effect<readonly { path: string; line: number; content: string }[]>;
  readonly writeFile: (file: SourceFile) => Effect.Effect<void, SchemaIdeToolFailure>;
  readonly createFile: (file: SourceFile) => Effect.Effect<void, SchemaIdeToolFailure>;
  readonly deleteFile: (path: string) => Effect.Effect<void, SchemaIdeToolFailure>;
  readonly renameFile: (
    fromPath: string,
    toPath: string,
  ) => Effect.Effect<void, SchemaIdeToolFailure>;
  readonly applyEdits: (
    edits: readonly SchemaIdeFileEdit[],
    options?: { readonly validate?: boolean | undefined },
  ) => Effect.Effect<
    {
      readonly changedPaths: readonly string[];
      readonly validation: SchemaIdeReflection["validationSummary"];
    },
    SchemaIdeToolFailure
  >;
  readonly proposePatch: (
    label: string,
    edits: readonly SchemaIdeFileEdit[],
  ) => Effect.Effect<SchemaIdePatchProposal, SchemaIdeToolFailure>;
  readonly validateWorkspace: Effect.Effect<SchemaIdeReflection>;
  readonly getSchema: Effect.Effect<SchemaIdeReflection["schemas"]>;
  readonly getJsonSchema: (schemaId?: string | null) => Effect.Effect<unknown>;
  readonly getDiagnostics: Effect.Effect<SchemaIdeReflection["diagnostics"]>;
}

export class SchemaIdeWorkspace extends Context.Service<
  SchemaIdeWorkspace,
  SchemaIdeWorkspaceService
>()("schema-ide/Workspace") {}

export const SchemaIdeWorkspaceLayer = (runtime: SchemaIdeToolRuntime) =>
  Layer.succeed(SchemaIdeWorkspace)({
    readFile: (path) =>
      Effect.sync(() => runtime.readFile(path)).pipe(
        Effect.flatMap((file) =>
          file ? Effect.succeed(file) : Effect.fail(toolFailure(`File not found: ${path}`)),
        ),
      ),
    listFiles: Effect.sync(() => Array.from(runtime.listFiles())),
    searchFiles: (query) => Effect.sync(() => Array.from(runtime.searchFiles(query))),
    writeFile: (file) =>
      Effect.try({
        try: () => runtime.writeFile(file),
        catch: toToolFailure,
      }),
    createFile: (file) =>
      Effect.try({
        try: () => runtime.createFile(file),
        catch: toToolFailure,
      }),
    deleteFile: (path) =>
      Effect.try({
        try: () => runtime.deleteFile(path),
        catch: toToolFailure,
      }),
    renameFile: (fromPath, toPath) =>
      Effect.try({
        try: () => runtime.renameFile(fromPath, toPath),
        catch: toToolFailure,
      }),
    applyEdits: (edits, options) =>
      Effect.try({
        try: () => runtime.applyEdits(edits, options),
        catch: toToolFailure,
      }),
    proposePatch: (label, edits) =>
      Effect.try({
        try: () => runtime.proposePatch(label, edits),
        catch: toToolFailure,
      }),
    validateWorkspace: Effect.sync(() => runtime.validateWorkspace()),
    getSchema: Effect.sync(() => runtime.getSchema()),
    getJsonSchema: (schemaId) => Effect.sync(() => runtime.getJsonSchema(schemaId ?? null)),
    getDiagnostics: Effect.sync(() => runtime.getDiagnostics()),
  });

export function toolFailure(error: string): SchemaIdeToolFailure {
  return { error };
}

export function toToolFailure(error: unknown): SchemaIdeToolFailure {
  return toolFailure(error instanceof Error ? error.message : String(error));
}
