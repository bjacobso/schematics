import { Effect, FileSystem, Layer, Path, Queue, Schema, Stream } from "effect";
import {
  Etag,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import {
  isSchemaIdeWorkspaceError,
  makeSchemaIdeWorkspaceRpcLayer,
  SchemaIdeWorkspaceError,
  SchemaIdeWorkspaceRpcGroup,
  WorkspaceChangeRequestSchema,
  type SchemaIdeWorkspaceClient,
} from "@schema-ide/protocol";
import { makeSchemaIdeHttpApiLive, type SchemaIdeServerOptions } from "./http-api";
import {
  LocalDebugOpenRouterClientLive,
  OpenRouterClientLive,
  type OpenRouterClientOptions,
} from "./openrouter-client";

export interface SchemaIdeAppOptions
  extends SchemaIdeServerOptions, Omit<OpenRouterClientOptions, "apiKey"> {
  readonly openRouterApiKey?: string | undefined;
  readonly staticDir?: string | undefined;
  readonly workspaceClient?: SchemaIdeWorkspaceClient | undefined;
  readonly workspaceRpcProtocol?: "http" | "websocket" | undefined;
}

export function makeSchemaIdeAppLayer(options: SchemaIdeAppOptions = {}) {
  const serverOptions =
    options.openRouterApiKey || options.models
      ? options
      : { ...options, models: [{ id: "local-debug", label: "Local Debug" }] };
  const openRouterLayer = options.openRouterApiKey
    ? OpenRouterClientLive({
        apiKey: options.openRouterApiKey,
        apiUrl: options.apiUrl,
        referer: options.referer,
        title: options.title,
      })
    : LocalDebugOpenRouterClientLive;
  const apiLayer = makeSchemaIdeHttpApiLive(serverOptions).pipe(Layer.provide(openRouterLayer));

  return Layer.mergeAll(
    apiLayer,
    makeWorkspaceRoutesLayer(options),
    makeStaticRoutesLayer(options.staticDir),
  );
}

export function makeSchemaIdeWebHandler(options: SchemaIdeAppOptions = {}): {
  readonly handler: (request: Request) => Promise<Response>;
  readonly dispose: () => Promise<void>;
} {
  return HttpRouter.toWebHandler(
    makeSchemaIdeAppLayer(options).pipe(Layer.provide([Etag.layer, HttpServer.layerServices])),
  );
}

function makeWorkspaceRoutesLayer(
  options: SchemaIdeAppOptions,
): Layer.Layer<never, never, HttpRouter.HttpRouter> {
  if (!options.workspaceClient) return Layer.empty;

  const rpcLayer = RpcServer.layerHttp({
    group: SchemaIdeWorkspaceRpcGroup,
    path: "/v1/workspace/rpc",
    protocol: options.workspaceRpcProtocol ?? "http",
  }).pipe(
    Layer.provide([
      makeSchemaIdeWorkspaceRpcLayer(options.workspaceClient),
      RpcSerialization.layerJson,
    ]),
  );

  return Layer.merge(rpcLayer, makeWorkspaceCompatibilityRoutesLayer(options.workspaceClient));
}

function makeWorkspaceCompatibilityRoutesLayer(
  workspaceClient: SchemaIdeWorkspaceClient,
): Layer.Layer<never, never, HttpRouter.HttpRouter> {
  const routes: ReadonlyArray<HttpRouter.Route<never, never>> = [
    HttpRouter.route("GET", "/v1/workspace/capabilities", () =>
      workspaceHttpJsonResponse(workspaceRequest(() => workspaceClient.getCapabilities())),
    ),
    HttpRouter.route("GET", "/v1/workspace/snapshot", () =>
      workspaceHttpJsonResponse(workspaceRequest(() => workspaceClient.getSnapshot())),
    ),
    HttpRouter.route("POST", "/v1/workspace/change", () =>
      HttpServerRequest.schemaBodyJson(WorkspaceChangeRequestSchema).pipe(
        Effect.mapError(toWorkspaceHttpError),
        Effect.flatMap((change) =>
          workspaceRequest(() => workspaceClient.applyChange(change)),
        ),
        workspaceHttpJsonResponse,
      ),
    ),
    HttpRouter.route(
      "GET",
      "/v1/workspace/watch",
      HttpServerResponse.stream(workspaceWatchStream(workspaceClient).pipe(Stream.encodeText), {
        headers: {
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        },
        contentType: "text/event-stream; charset=utf-8",
      }),
    ),
  ];
  return HttpRouter.addAll(routes);
}

function workspaceWatchStream(workspaceClient: SchemaIdeWorkspaceClient) {
  return Stream.callback<string>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        Queue.offerUnsafe(queue, ": connected\n\n");
        return workspaceClient.watchWorkspace(
          (event) => Queue.offerUnsafe(queue, `data: ${JSON.stringify(event)}\n\n`),
          (error) =>
            Queue.offerUnsafe(
              queue,
              `data: ${JSON.stringify({
                type: "error",
                message: error instanceof Error ? error.message : String(error),
              })}\n\n`,
            ),
        );
      }),
      (subscription) => Effect.sync(() => subscription.unsubscribe()),
    ),
  );
}

function makeStaticRoutesLayer(
  staticDir: string | undefined,
): Layer.Layer<never, never, FileSystem.FileSystem | HttpRouter.HttpRouter | Path.Path> {
  if (!staticDir) return Layer.empty;

  return HttpRouter.use((router) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const routes: ReadonlyArray<HttpRouter.Route<never, never>> = [
        HttpRouter.route("GET", "*", (request) =>
          serveStaticRequest(fs, path, staticDir, request, false),
        ),
        HttpRouter.route("HEAD", "*", (request) =>
          serveStaticRequest(fs, path, staticDir, request, true),
        ),
      ];
      yield* router.addAll(routes);
    }),
  );
}

function serveStaticRequest(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  staticDir: string,
  request: HttpServerRequest.HttpServerRequest,
  metadataOnly: boolean,
) {
  return Effect.gen(function* () {
    const url = new URL(request.url, "http://schema-ide.local");
    if (url.pathname.startsWith("/v1")) {
      return HttpServerResponse.text("Not found", {
        status: 404,
        contentType: "text/plain; charset=utf-8",
      });
    }

    const asset = yield* resolveStaticAsset(fs, path, staticDir, url.pathname, metadataOnly);
    switch (asset.status) {
      case "forbidden":
        return HttpServerResponse.text("Forbidden", {
          status: 403,
          contentType: "text/plain; charset=utf-8",
        });
      case "not-found":
        return HttpServerResponse.text("Not found", {
          status: 404,
          contentType: "text/plain; charset=utf-8",
        });
      case "found":
        return metadataOnly
          ? HttpServerResponse.empty({
              status: 200,
              headers: { "content-type": asset.contentType },
            })
          : HttpServerResponse.uint8Array(asset.body, { contentType: asset.contentType });
    }
  });
}

type StaticAssetResult =
  | { readonly status: "forbidden" }
  | { readonly status: "not-found" }
  | { readonly status: "found"; readonly contentType: string; readonly body: Uint8Array };

function resolveStaticAsset(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  staticDir: string,
  pathname: string,
  metadataOnly: boolean,
): Effect.Effect<StaticAssetResult> {
  return Effect.gen(function* () {
    const root = path.resolve(staticDir);
    const filePath = resolveStaticFile(path, root, pathname);
    if (!filePath) return { status: "forbidden" } as const;

    const found = yield* findStaticFile(fs, path, root, filePath, pathname);
    if (!found) return { status: "not-found" } as const;

    return {
      status: "found",
      contentType: contentTypeForPath(path, found),
      body: metadataOnly ? new Uint8Array() : yield* fs.readFile(found),
    } as const;
  }).pipe(Effect.catch(() => Effect.succeed({ status: "not-found" } as const)));
}

function resolveStaticFile(path: Path.Path, root: string, pathname: string): string | null {
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const candidate = path.resolve(root, `.${decodedPathname}`);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
}

function findStaticFile(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  filePath: string,
  pathname: string,
) {
  return Effect.gen(function* () {
    const file = yield* statFile(fs, filePath);
    if (file?.type === "File") return filePath;
    if (file?.type === "Directory") {
      const indexPath = path.join(filePath, "index.html");
      if ((yield* statFile(fs, indexPath))?.type === "File") return indexPath;
    }

    if (!path.extname(pathname)) {
      const fallbackPath = path.join(root, "index.html");
      if ((yield* statFile(fs, fallbackPath))?.type === "File") return fallbackPath;
    }

    return null;
  });
}

function statFile(fs: FileSystem.FileSystem, filePath: string) {
  return fs.stat(filePath).pipe(Effect.catch(() => Effect.succeed(null)));
}

function contentTypeForPath(path: Path.Path, filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}

class WorkspaceHttpUnknownError extends Error {
  readonly _tag = "WorkspaceHttpUnknownError" as const;

  constructor(readonly originalCause: unknown) {
    super(originalCause instanceof Error ? originalCause.message : String(originalCause));
    this.name = "WorkspaceHttpUnknownError";
  }
}

type WorkspaceHttpError =
  | Schema.SchemaError
  | SchemaIdeWorkspaceError
  | WorkspaceHttpUnknownError;

function workspaceRequest<A>(evaluate: () => Promise<A>): Effect.Effect<A, WorkspaceHttpError> {
  return Effect.tryPromise({
    try: evaluate,
    catch: toWorkspaceHttpError,
  });
}

function toWorkspaceHttpError(error: unknown): WorkspaceHttpError {
  if (isSchemaIdeWorkspaceError(error)) return error;
  if (Schema.isSchemaError(error)) return error;
  return new WorkspaceHttpUnknownError(error);
}

function workspaceHttpJsonResponse<A, R>(effect: Effect.Effect<A, WorkspaceHttpError, R>) {
  return effect.pipe(
    Effect.flatMap((body) => HttpServerResponse.json(body).pipe(Effect.orDie)),
    Effect.catchTag("SchemaIdeWorkspaceError", workspaceClientErrorResponse),
    Effect.catchTag("SchemaError", workspaceSchemaErrorResponse),
    Effect.catchTag("WorkspaceHttpUnknownError", workspaceUnknownErrorResponse),
  );
}

function workspaceClientErrorResponse(error: SchemaIdeWorkspaceError) {
  return workspaceTextResponse(error.message, 400);
}

function workspaceSchemaErrorResponse(error: Schema.SchemaError) {
  return workspaceTextResponse(error.message, 400);
}

function workspaceUnknownErrorResponse(error: WorkspaceHttpUnknownError) {
  return workspaceTextResponse(error.message, 500);
}

function workspaceTextResponse(message: string, status: number) {
  return Effect.succeed(
    HttpServerResponse.text(message, {
      status,
      contentType: "text/plain; charset=utf-8",
    }),
  );
}
