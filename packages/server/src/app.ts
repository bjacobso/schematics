import { Effect, FileSystem, Layer, Path } from "effect";
import {
  Etag,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import {
  SchemaIdeWorkspaceBranchRpcGroup,
  SchemaIdeWorkspaceRpcGroup,
  type SchemaIdeWorkspaceBranchService,
  type SchemaIdeWorkspaceService,
} from "@schema-ide/protocol";
import { makeSchemaIdeHttpApiLive, type SchemaIdeServerOptions } from "./http-api.ts";
import {
  LocalDebugOpenRouterClientLive,
  OpenRouterClient,
  OpenRouterClientLive,
  type DebugOpenRouterClientOptions,
  type OpenRouterClientOptions,
} from "./openrouter-client.ts";
import { makeSchemaIdeWorkspaceRpcLayer } from "./workspace-rpc.ts";
import { makeSchemaIdeWorkspaceBranchRpcLayer } from "./workspace-branch-rpc.ts";

export interface SchemaIdeAppOptions<ROpenRouter = never, EOpenRouter = never>
  extends SchemaIdeServerOptions, Omit<OpenRouterClientOptions, "apiKey"> {
  readonly openRouterApiKey?: string | undefined;
  readonly openRouterLayer?: Layer.Layer<OpenRouterClient, EOpenRouter, ROpenRouter> | undefined;
  readonly debugChat?:
    | (DebugOpenRouterClientOptions & {
        readonly modelLabel?: string | undefined;
      })
    | undefined;
  readonly staticDir?: string | undefined;
  readonly staticAssets?: SchemaIdeStaticAssets | undefined;
  readonly workspace?: SchemaIdeWorkspaceService | undefined;
  readonly workspaceBranches?: SchemaIdeWorkspaceBranchService | undefined;
  readonly workspaceBranch?: ((branchId: string) => SchemaIdeWorkspaceService | null) | undefined;
  readonly workspaceRpcProtocol?: "http" | "websocket" | undefined;
}

export type SchemaIdeStaticAssets = Readonly<Record<string, string>>;

export function makeSchemaIdeAppLayer<ROpenRouter = never, EOpenRouter = never>(
  options: SchemaIdeAppOptions<ROpenRouter, EOpenRouter> = {},
) {
  const debugModelLabel = options.debugChat?.modelLabel ?? "Local Debug";
  const serverOptions =
    options.openRouterLayer || options.openRouterApiKey || options.models
      ? options
      : { ...options, models: [{ id: "local-debug", label: debugModelLabel }] };
  const openRouterLayer =
    options.openRouterLayer ??
    (options.openRouterApiKey
      ? OpenRouterClientLive({
          apiKey: options.openRouterApiKey,
          apiUrl: options.apiUrl,
          referer: options.referer,
          title: options.title,
        })
      : LocalDebugOpenRouterClientLive(options.debugChat));
  const apiLayer = makeSchemaIdeHttpApiLive(serverOptions).pipe(Layer.provide(openRouterLayer));

  return Layer.mergeAll(
    apiLayer,
    makeWorkspaceRoutesLayer(options),
    makeStaticRoutesLayer(options.staticDir, options.staticAssets),
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
  options: Pick<
    SchemaIdeAppOptions,
    "workspace" | "workspaceBranches" | "workspaceBranch" | "workspaceRpcProtocol"
  >,
): Layer.Layer<never, never, HttpRouter.HttpRouter> {
  const layers: Layer.Layer<never, never, HttpRouter.HttpRouter>[] = [];

  if (options.workspace) {
    layers.push(
      RpcServer.layerHttp({
        group: SchemaIdeWorkspaceRpcGroup,
        path: "/v1/workspace/rpc",
        protocol: options.workspaceRpcProtocol ?? "http",
      }).pipe(
        Layer.provide([
          makeSchemaIdeWorkspaceRpcLayer(options.workspace),
          RpcSerialization.layerNdjson,
        ]),
      ),
    );
  }

  if (options.workspaceBranches) {
    layers.push(
      RpcServer.layerHttp({
        group: SchemaIdeWorkspaceBranchRpcGroup,
        path: "/v1/workspace/branch-rpc",
        protocol: "http",
      }).pipe(
        Layer.provide([
          makeSchemaIdeWorkspaceBranchRpcLayer(options.workspaceBranches),
          RpcSerialization.layerNdjson,
        ]),
      ),
    );
  }

  if (options.workspaceBranch) {
    layers.push(makeBranchScopedWorkspaceRoutesLayer(options.workspaceBranch));
  }

  if (!layers.length) return Layer.empty;
  let layer = layers[0]!;
  for (const next of layers.slice(1)) {
    layer = Layer.merge(layer, next);
  }
  return layer;
}

function makeBranchScopedWorkspaceRoutesLayer(
  workspaceBranch: (branchId: string) => SchemaIdeWorkspaceService | null,
): Layer.Layer<never, never, HttpRouter.HttpRouter> {
  const handlers = new Map<string, ReturnType<typeof makeWorkspaceRpcWebHandler>>();
  const routeHandler = (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const branchId = branchIdFromWorkspaceRpcUrl(request.url);
      if (!branchId) {
        return HttpServerResponse.text("Not found", {
          status: 404,
          contentType: "text/plain; charset=utf-8",
        });
      }

      const workspace = workspaceBranch(branchId);
      if (!workspace) {
        return HttpServerResponse.text("Workspace branch not found", {
          status: 404,
          contentType: "text/plain; charset=utf-8",
        });
      }

      let handler = handlers.get(branchId);
      if (!handler) {
        handler = makeWorkspaceRpcWebHandler(workspace);
        handlers.set(branchId, handler);
      }

      const body = yield* request.arrayBuffer;
      const rpcUrl = new URL(request.url, "http://schema-ide.local");
      rpcUrl.pathname = "/v1/workspace/rpc";
      const response = yield* Effect.promise(() =>
        handler.handler(
          new Request(rpcUrl.toString(), {
            method: "POST",
            headers: request.headers,
            body,
          } as RequestInit),
        ),
      );
      const responseBody = new Uint8Array(yield* Effect.promise(() => response.arrayBuffer()));
      return HttpServerResponse.uint8Array(responseBody, {
        status: response.status,
        headers: response.headers,
      });
    }).pipe(
      Effect.catch((error: unknown) =>
        Effect.succeed(
          HttpServerResponse.text(error instanceof Error ? error.message : String(error), {
            status: 500,
            contentType: "text/plain; charset=utf-8",
          }),
        ),
      ),
    );

  return HttpRouter.add("POST", "/v1/workspace/branches/:branchId/rpc", routeHandler);
}

function makeWorkspaceRpcWebHandler(workspace: SchemaIdeWorkspaceService) {
  return HttpRouter.toWebHandler(
    RpcServer.layerHttp({
      group: SchemaIdeWorkspaceRpcGroup,
      path: "/v1/workspace/rpc",
      protocol: "http",
    }).pipe(
      Layer.provide([makeSchemaIdeWorkspaceRpcLayer(workspace), RpcSerialization.layerNdjson]),
      Layer.provide([Etag.layer, HttpServer.layerServices]),
    ),
  );
}

function branchIdFromWorkspaceRpcUrl(url: string): string | null {
  const pathname = new URL(url, "http://schema-ide.local").pathname;
  const match = /^\/v1\/workspace\/branches\/([^/]+)\/rpc\/?$/.exec(pathname);
  return match ? decodeURIComponent(match[1] ?? "") : null;
}

function makeStaticRoutesLayer(
  staticDir: string | undefined,
  staticAssets: SchemaIdeStaticAssets | undefined,
): Layer.Layer<never, never, FileSystem.FileSystem | HttpRouter.HttpRouter | Path.Path> {
  if (staticDir) return makeStaticDirRoutesLayer(staticDir);
  if (staticAssets) return makeStaticAssetRoutesLayer(staticAssets);
  return Layer.empty;
}

function makeStaticDirRoutesLayer(
  staticDir: string,
): Layer.Layer<never, never, FileSystem.FileSystem | HttpRouter.HttpRouter | Path.Path> {
  return HttpRouter.use((router) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const routes: ReadonlyArray<HttpRouter.Route<never, never>> = [
        HttpRouter.route("GET", "*", (request) =>
          serveStaticDirRequest(fs, path, staticDir, request, false),
        ),
        HttpRouter.route("HEAD", "*", (request) =>
          serveStaticDirRequest(fs, path, staticDir, request, true),
        ),
      ];
      yield* router.addAll(routes);
    }),
  );
}

function makeStaticAssetRoutesLayer(
  staticAssets: SchemaIdeStaticAssets,
): Layer.Layer<never, never, HttpRouter.HttpRouter> {
  return HttpRouter.use((router) =>
    Effect.gen(function* () {
      const routes: ReadonlyArray<HttpRouter.Route<never, never>> = [
        HttpRouter.route("GET", "*", (request) =>
          serveStaticAssetRequest(staticAssets, request, false),
        ),
        HttpRouter.route("HEAD", "*", (request) =>
          serveStaticAssetRequest(staticAssets, request, true),
        ),
      ];
      yield* router.addAll(routes);
    }),
  );
}

function serveStaticDirRequest(
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

function serveStaticAssetRequest(
  staticAssets: SchemaIdeStaticAssets,
  request: HttpServerRequest.HttpServerRequest,
  metadataOnly: boolean,
) {
  return Effect.sync(() => {
    const url = new URL(request.url, "http://schema-ide.local");
    if (url.pathname.startsWith("/v1")) {
      return HttpServerResponse.text("Not found", {
        status: 404,
        contentType: "text/plain; charset=utf-8",
      });
    }

    const asset = resolveStaticAssetFromMap(staticAssets, url.pathname, metadataOnly);
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

function resolveStaticAssetFromMap(
  staticAssets: SchemaIdeStaticAssets,
  pathname: string,
  metadataOnly: boolean,
): StaticAssetResult {
  const assetPath = resolveStaticAssetPath(pathname);
  if (!assetPath) return { status: "forbidden" };

  const found = findStaticAsset(staticAssets, assetPath);
  if (!found) return { status: "not-found" };

  return {
    status: "found",
    contentType: contentTypeForExtension(extname(found.path)),
    body: metadataOnly ? new Uint8Array() : decodeBase64(found.content),
  };
}

function findStaticAsset(
  staticAssets: SchemaIdeStaticAssets,
  assetPath: string,
): { readonly path: string; readonly content: string } | null {
  const direct = staticAssets[assetPath];
  if (direct) return { path: assetPath, content: direct };

  if (assetPath.endsWith("/")) {
    const indexPath = `${assetPath}index.html`;
    const index = staticAssets[indexPath];
    if (index) return { path: indexPath, content: index };
  }

  const fallback = !extname(assetPath) ? staticAssets["index.html"] : undefined;
  return fallback ? { path: "index.html", content: fallback } : null;
}

function resolveStaticAssetPath(pathname: string): string | null {
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (decodedPathname === "/") return "index.html";

  const relativePathname = decodedPathname.replace(/^\/+/, "");
  const segments = relativePathname.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) return null;

  return segments.length ? segments.join("/") : "index.html";
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
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
  return contentTypeForExtension(path.extname(filePath));
}

function contentTypeForExtension(extension: string): string {
  switch (extension.toLowerCase()) {
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

function extname(filePath: string): string {
  const segment = filePath.split("/").at(-1) ?? "";
  const index = segment.lastIndexOf(".");
  return index > 0 ? segment.slice(index) : "";
}
