import { Context, Effect, Layer } from "effect";
import type { SchemaIdeReflection, SourceFile } from "@schema-ide/core";
import type { SchemaIdeFileEdit, SchemaIdePatchProposal, SchemaIdeHostRuntime } from "./types";
import type { SchemaIdeToolFailure } from "./common-toolkit-schemas";

export interface SchemaIdeWorkspaceService {
  readonly readFile: (path: string) => Effect.Effect<SourceFile, SchemaIdeToolFailure>;
  readonly listFiles: Effect.Effect<readonly string[], SchemaIdeToolFailure>;
  readonly searchFiles: (
    query: string,
  ) => Effect.Effect<
    readonly { path: string; line: number; content: string }[],
    SchemaIdeToolFailure
  >;
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

export const SchemaIdeWorkspaceLayer = (runtime: SchemaIdeHostRuntime) =>
  Layer.succeed(SchemaIdeWorkspace)({
    readFile: (path) =>
      Effect.tryPromise({
        try: () => Promise.resolve(runtime.readFile(path)),
        catch: toToolFailure,
      }).pipe(
        Effect.flatMap((file) =>
          file ? Effect.succeed(file) : Effect.fail(toolFailure(`File not found: ${path}`)),
        ),
      ),
    listFiles: Effect.tryPromise({
      try: async () => Array.from(await runtime.listFiles()),
      catch: toToolFailure,
    }),
    searchFiles: (query) =>
      Effect.tryPromise({
        try: async () => Array.from(await runtime.searchFiles(query)),
        catch: toToolFailure,
      }),
    writeFile: (file) =>
      Effect.tryPromise({
        try: async () => {
          await runtime.writeFile(file);
        },
        catch: toToolFailure,
      }),
    createFile: (file) =>
      Effect.tryPromise({
        try: async () => {
          await runtime.createFile(file);
        },
        catch: toToolFailure,
      }),
    deleteFile: (path) =>
      Effect.tryPromise({
        try: async () => {
          await runtime.deleteFile(path);
        },
        catch: toToolFailure,
      }),
    renameFile: (fromPath, toPath) =>
      Effect.tryPromise({
        try: async () => {
          await runtime.renameFile(fromPath, toPath);
        },
        catch: toToolFailure,
      }),
    applyEdits: (edits, options) =>
      Effect.tryPromise({
        try: () => Promise.resolve(runtime.applyEdits(edits, options)),
        catch: toToolFailure,
      }),
    proposePatch: (label, edits) =>
      Effect.tryPromise({
        try: () => Promise.resolve(runtime.proposePatch(label, edits)),
        catch: toToolFailure,
      }),
    validateWorkspace: Effect.promise(() => Promise.resolve(runtime.validateWorkspace())),
    getSchema: Effect.promise(() => Promise.resolve(runtime.getSchema())),
    getJsonSchema: (schemaId) =>
      Effect.promise(() => Promise.resolve(runtime.getJsonSchema(schemaId ?? null))),
    getDiagnostics: Effect.promise(() => Promise.resolve(runtime.getDiagnostics())),
  });

export function toolFailure(error: string): SchemaIdeToolFailure {
  return { error };
}

export function toToolFailure(error: unknown): SchemaIdeToolFailure {
  return toolFailure(error instanceof Error ? error.message : String(error));
}
