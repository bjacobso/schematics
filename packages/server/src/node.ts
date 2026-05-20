import { NodeFileSystem, NodeHttpPlatform, NodePath } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Path } from "effect";
import { Etag, HttpRouter } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import {
  makeSchemaIdeWorkspaceRpcLayer,
  SchemaIdeWorkspaceRpcGroup,
  type SchemaIdeWorkspaceClient,
  type WorkspaceChangeRequest,
} from "@schema-ide/protocol";
import { makeSchemaIdeHttpApiLive, type SchemaIdeServerOptions } from "./http-api";
import {
  LocalDebugOpenRouterClientLive,
  OpenRouterClientLive,
  type OpenRouterClientOptions,
} from "./openrouter-client";

const NodeStaticLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer);

export interface SchemaIdeNodeServerOptions
  extends SchemaIdeServerOptions, Omit<OpenRouterClientOptions, "apiKey"> {
  readonly openRouterApiKey?: string | undefined;
  readonly port?: number | undefined;
  readonly staticDir?: string | undefined;
  readonly workspaceClient?: SchemaIdeWorkspaceClient | undefined;
}

export interface SchemaIdeNodeServerHandle {
  readonly port: number;
  readonly close: () => Promise<void>;
}

export function makeSchemaIdeHttpHandler(options: SchemaIdeNodeServerOptions): {
  readonly handler: (request: Request) => Promise<Response>;
  readonly dispose: () => Promise<void>;
} {
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
  const appLayer = options.workspaceClient
    ? Layer.merge(
        apiLayer,
        RpcServer.layerHttp({
          group: SchemaIdeWorkspaceRpcGroup,
          path: "/v1/workspace/rpc",
          protocol: "http",
        }).pipe(
          Layer.provide([
            makeSchemaIdeWorkspaceRpcLayer(options.workspaceClient),
            RpcSerialization.layerJson,
          ]),
        ),
      )
    : apiLayer;
  return HttpRouter.toWebHandler(
    appLayer.pipe(
      Layer.provide([Etag.layer, NodeFileSystem.layer, NodeHttpPlatform.layer, NodePath.layer]),
    ),
  );
}

export async function runSchemaIdeHttpServer(
  options: SchemaIdeNodeServerOptions,
): Promise<SchemaIdeNodeServerHandle> {
  const requestedPort = options.port ?? 4317;
  const webHandler = makeSchemaIdeHttpHandler({ ...options, port: requestedPort });
  const server = createServer(async (req, res) => {
    try {
      const port = resolveServerPort(server.address(), requestedPort);
      if (await tryServeWorkspace(req, res, options.workspaceClient, port)) return;
      if (await tryServeStatic(req, res, options.staticDir, port)) return;

      const request = nodeRequestToFetch(req, port);
      const response = await webHandler.handler(request);
      await writeFetchResponse(response, res);
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`Schema IDE server error: ${String(error)}`);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const port = resolveServerPort(server.address(), requestedPort);
  return {
    port,
    close: async () => {
      await webHandler.dispose();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function tryServeWorkspace(
  req: IncomingMessage,
  res: ServerResponse,
  workspaceClient: SchemaIdeWorkspaceClient | undefined,
  port: number,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (!url.pathname.startsWith("/v1/workspace")) return false;
  if (url.pathname.startsWith("/v1/workspace/rpc")) return false;

  if (!workspaceClient) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Workspace service is not configured.");
    return true;
  }

  try {
    if (req.method === "GET" && url.pathname === "/v1/workspace/capabilities") {
      writeJson(res, await workspaceClient.getCapabilities());
      return true;
    }

    if (req.method === "GET" && url.pathname === "/v1/workspace/snapshot") {
      writeJson(res, await workspaceClient.getSnapshot());
      return true;
    }

    if (req.method === "POST" && url.pathname === "/v1/workspace/change") {
      const change = JSON.parse(await readRequestBody(req)) as WorkspaceChangeRequest;
      writeJson(res, await workspaceClient.applyChange(change));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/v1/workspace/watch") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");
      const subscription = workspaceClient.watchWorkspace((event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });
      req.once("close", () => subscription.unsubscribe());
      return true;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Workspace endpoint not found.");
    return true;
  } catch (error) {
    const status =
      error instanceof Error && error.name === "SchemaIdeWorkspaceError" ? 400 : 500;
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(error instanceof Error ? error.message : String(error));
    return true;
  }
}

function writeJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function tryServeStatic(
  req: IncomingMessage,
  res: ServerResponse,
  staticDir: string | undefined,
  port: number,
): Promise<boolean> {
  if (!staticDir || (req.method !== "GET" && req.method !== "HEAD")) return false;

  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (url.pathname.startsWith("/v1")) return false;

  const asset = await resolveStaticAsset(staticDir, url.pathname, req.method === "HEAD");
  if (asset.status === "forbidden") {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return true;
  }

  if (asset.status === "not-found") {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return true;
  }

  res.writeHead(200, {
    "Content-Type": asset.contentType,
  });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }

  res.end(asset.body);
  return true;
}

type StaticAssetResult =
  | { readonly status: "forbidden" }
  | { readonly status: "not-found" }
  | { readonly status: "found"; readonly contentType: string; readonly body?: Uint8Array };

function resolveStaticAsset(
  staticDir: string,
  pathname: string,
  metadataOnly: boolean,
): Promise<StaticAssetResult> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = path.resolve(staticDir);
      const filePath = resolveStaticFile(path, root, pathname);
      if (!filePath) return { status: "forbidden" } as const;

      const found = yield* findStaticFile(fs, path, root, filePath, pathname);
      if (!found) return { status: "not-found" } as const;

      return {
        status: "found",
        contentType: contentTypeForPath(path, found),
        ...(metadataOnly ? {} : { body: yield* fs.readFile(found) }),
      } as const;
    }).pipe(Effect.provide(NodeStaticLayer)),
  );
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

function resolveServerPort(address: string | AddressInfo | null, fallbackPort: number): number {
  return typeof address === "object" && address !== null ? address.port : fallbackPort;
}

function nodeRequestToFetch(req: IncomingMessage, port: number): Request {
  const url = `http://localhost:${port}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const headerValue of value) headers.append(key, headerValue);
    } else {
      headers.set(key, value);
    }
  }

  const method = req.method ?? "GET";
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(req) as ReadableStream;
    (init as Record<string, unknown>)["duplex"] = "half";
  }

  return new Request(url, init);
}

async function writeFetchResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "transfer-encoding") res.setHeader(key, value);
  });

  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  res.end();
}
