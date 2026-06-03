import { Context, Effect, Layer } from "effect";
import {
  formatForPath,
  parseDocument,
  type SchematicsReflection,
  type SourceFile,
} from "@schematics/core";
import type {
  ArtifactCapability,
  ArtifactRef,
  GetArtifactCapabilitiesResponse,
  ListArtifactRefsResponse,
  ReadArtifactViewRequest,
  ReadArtifactViewResponse,
} from "@schematics/protocol";
import type { SchematicsFileEdit, SchematicsPatchProposal, SchematicsHostRuntime } from "./types";
import type { SchematicsToolFailure } from "./common-toolkit-schemas";

export interface SchematicsArtifactProjectService {
  readonly readFile: (path: string) => Effect.Effect<SourceFile, SchematicsToolFailure>;
  readonly listFiles: Effect.Effect<readonly string[], SchematicsToolFailure>;
  readonly searchFiles: (
    query: string,
  ) => Effect.Effect<
    readonly { path: string; line: number; content: string }[],
    SchematicsToolFailure
  >;
  readonly writeFile: (file: SourceFile) => Effect.Effect<void, SchematicsToolFailure>;
  readonly createFile: (file: SourceFile) => Effect.Effect<void, SchematicsToolFailure>;
  readonly deleteFile: (path: string) => Effect.Effect<void, SchematicsToolFailure>;
  readonly renameFile: (
    fromPath: string,
    toPath: string,
  ) => Effect.Effect<void, SchematicsToolFailure>;
  readonly applyEdits: (
    edits: readonly SchematicsFileEdit[],
    options?: { readonly validate?: boolean | undefined },
  ) => Effect.Effect<
    {
      readonly changedPaths: readonly string[];
      readonly validation: SchematicsReflection["validationSummary"];
    },
    SchematicsToolFailure
  >;
  readonly proposePatch: (
    label: string,
    edits: readonly SchematicsFileEdit[],
  ) => Effect.Effect<SchematicsPatchProposal, SchematicsToolFailure>;
  readonly validateWorkspace: Effect.Effect<SchematicsReflection>;
  readonly getSchema: Effect.Effect<SchematicsReflection["schemas"]>;
  readonly getJsonSchema: (schemaId?: string | null) => Effect.Effect<unknown>;
  readonly getDiagnostics: Effect.Effect<SchematicsReflection["diagnostics"]>;
  readonly listArtifacts: Effect.Effect<ListArtifactRefsResponse, SchematicsToolFailure>;
  readonly getArtifactCapabilities: (
    ref: ArtifactRef,
  ) => Effect.Effect<GetArtifactCapabilitiesResponse, SchematicsToolFailure>;
  readonly readArtifactView: (
    request: ReadArtifactViewRequest,
  ) => Effect.Effect<ReadArtifactViewResponse, SchematicsToolFailure>;
  readonly writeArtifactSource: (
    ref: Extract<ArtifactRef, { readonly _tag: "ProjectFile" }>,
    content: string,
  ) => Effect.Effect<
    {
      readonly success: true;
      readonly path: string;
      readonly validation: SchematicsReflection["validationSummary"];
    },
    SchematicsToolFailure
  >;
}

export class SchematicsWorkspace extends Context.Service<
  SchematicsWorkspace,
  SchematicsArtifactProjectService
>()("schematics/Workspace") {}

export const SchematicsWorkspaceLayer = (runtime: SchematicsHostRuntime) =>
  Layer.succeed(SchematicsWorkspace)({
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
    listArtifacts: runtime.listArtifacts
      ? Effect.tryPromise({
          try: () => Promise.resolve(runtime.listArtifacts!()),
          catch: toToolFailure,
        })
      : Effect.gen(function* () {
          const files = yield* Effect.tryPromise({
            try: async () => Array.from(await runtime.listFiles()),
            catch: toToolFailure,
          });
          const artifacts = [
            { _tag: "Project" as const },
            ...files.map((path) => ({ _tag: "ProjectFile" as const, path })),
          ];
          return { artifacts, count: artifacts.length };
        }),
    getArtifactCapabilities: runtime.getArtifactCapabilities
      ? (ref) =>
          Effect.tryPromise({
            try: () => Promise.resolve(runtime.getArtifactCapabilities!(ref)),
            catch: toToolFailure,
          })
      : (ref) => fallbackArtifactCapabilities(runtime, ref),
    readArtifactView: runtime.readArtifactView
      ? (request) =>
          Effect.tryPromise({
            try: () => Promise.resolve(runtime.readArtifactView!(request)),
            catch: toToolFailure,
          })
      : (request) => fallbackArtifactView(runtime, request),
    writeArtifactSource: runtime.writeArtifactSource
      ? (ref, content) =>
          Effect.tryPromise({
            try: async () => {
              const result = await runtime.writeArtifactSource!(
                { _tag: "ProjectFile" as const, path: ref.path },
                content,
              );
              return { success: true as const, path: ref.path, validation: result.validation };
            },
            catch: toToolFailure,
          })
      : (ref, content) =>
          Effect.gen(function* () {
            yield* Effect.tryPromise({
              try: async () => {
                await runtime.writeFile({ path: ref.path, content });
              },
              catch: toToolFailure,
            });
            const reflection = yield* Effect.promise(() =>
              Promise.resolve(runtime.validateWorkspace()),
            );
            return {
              success: true as const,
              path: ref.path,
              validation: reflection.validationSummary,
            };
          }),
  });

export function toolFailure(error: string): SchematicsToolFailure {
  return { error };
}

export function toToolFailure(error: unknown): SchematicsToolFailure {
  return toolFailure(error instanceof Error ? error.message : String(error));
}

function fallbackArtifactCapabilities(runtime: SchematicsHostRuntime, ref: ArtifactRef) {
  return Effect.gen(function* () {
    if (ref._tag === "Project") {
      return { capabilities: workspaceCapabilities() };
    }

    const reflection = yield* Effect.promise(() => Promise.resolve(runtime.validateWorkspace()));
    const route = reflection.routeMatches.find((candidate) => candidate.path === ref.path);
    const routeId = route?.schemaId ?? undefined;
    const routePattern = routeId
      ? reflection.schemas.find((schema) => schema.id === routeId)?.match
      : undefined;
    return { capabilities: fileCapabilities(routeId, routePattern) };
  });
}

function fallbackArtifactView(runtime: SchematicsHostRuntime, request: ReadArtifactViewRequest) {
  if (request.ref._tag === "Project") {
    return fallbackWorkspaceView(runtime, request);
  }
  return fallbackProjectFileView(runtime, {
    ref: request.ref,
    view: request.view,
  });
}

function fallbackWorkspaceView(runtime: SchematicsHostRuntime, request: ReadArtifactViewRequest) {
  return Effect.gen(function* () {
    const reflection = yield* Effect.promise(() => Promise.resolve(runtime.validateWorkspace()));
    switch (request.view) {
      case "decodedWorkspace":
        return { ...request, value: reflection.decodedValue };
      case "diagnostics":
        return { ...request, value: Array.from(reflection.diagnostics) };
      case "validationSummary":
        return { ...request, value: reflection.validationSummary };
      case "routeMatches":
        return { ...request, value: Array.from(reflection.routeMatches) };
      case "reflection":
        return { ...request, value: reflection };
      default:
        return yield* Effect.fail(toolFailure(`Unknown project artifact view: ${request.view}`));
    }
  });
}

function fallbackProjectFileView(
  runtime: SchematicsHostRuntime,
  request: ReadArtifactViewRequest & {
    readonly ref: Extract<ArtifactRef, { readonly _tag: "ProjectFile" }>;
  },
) {
  return Effect.gen(function* () {
    const file = yield* Effect.tryPromise({
      try: () => Promise.resolve(runtime.readFile(request.ref.path)),
      catch: toToolFailure,
    }).pipe(
      Effect.flatMap((file) =>
        file
          ? Effect.succeed(file)
          : Effect.fail(toolFailure(`File not found: ${request.ref.path}`)),
      ),
    );
    switch (request.view) {
      case "sourceText":
        return { ...request, value: file.content };
      case "parsedValue": {
        const parsed = parseDocument(
          file.content,
          formatForPath(request.ref.path),
          request.ref.path,
        );
        if (!parsed.success) return yield* Effect.fail(toolFailure(parsed.diagnostic.message));
        return { ...request, value: parsed.value };
      }
      case "jsonSchema": {
        const reflection = yield* Effect.promise(() =>
          Promise.resolve(runtime.validateWorkspace()),
        );
        const route = reflection.routeMatches.find(
          (candidate) => candidate.path === request.ref.path,
        );
        if (!route?.schemaId) return { ...request, value: null };
        return {
          ...request,
          value:
            reflection.schemas.find((schema) => schema.id === route.schemaId)?.jsonSchema ?? null,
        };
      }
      case "diagnostics": {
        const reflection = yield* Effect.promise(() =>
          Promise.resolve(runtime.validateWorkspace()),
        );
        return {
          ...request,
          value: reflection.diagnostics.filter(
            (diagnostic) => diagnostic.path === request.ref.path || diagnostic.path === null,
          ),
        };
      }
      default:
        return yield* Effect.fail(
          toolFailure(`Unknown workspace file artifact view: ${request.view}`),
        );
    }
  });
}

function workspaceCapabilities(): readonly ArtifactCapability[] {
  return [
    capability("schematics.project.decodedWorkspace", "schematics.project", "decodedWorkspace"),
    capability("schematics.project.diagnostics", "schematics.project", "diagnostics"),
    capability("schematics.project.validationSummary", "schematics.project", "validationSummary"),
    capability("schematics.project.routeMatches", "schematics.project", "routeMatches"),
    capability("schematics.project.reflection", "schematics.project", "reflection"),
  ];
}

function fileCapabilities(routeId?: string, routePattern?: string): readonly ArtifactCapability[] {
  const type = "schematics.project-file";
  return [
    capability("schematics.project-file.sourceText", type, "sourceText", routeId, routePattern),
    capability("schematics.project-file.parsedValue", type, "parsedValue", routeId, routePattern),
    capability("schematics.project-file.jsonSchema", type, "jsonSchema", routeId, routePattern),
    capability("schematics.project-file.diagnostics", type, "diagnostics", routeId, routePattern),
  ];
}

function capability(
  id: string,
  type: string,
  view: string,
  routeId?: string,
  routePattern?: string,
): ArtifactCapability {
  return {
    id,
    type,
    view,
    annotations: {},
    ...(routeId ? { routeId } : {}),
    ...(routePattern ? { routePattern } : {}),
  };
}
