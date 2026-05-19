import { NodeFileSystem, NodeHttpPlatform, NodePath } from "@effect/platform-node";
import { Layer } from "effect";
import { Etag, HttpRouter } from "effect/unstable/http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { makeSchemaIdeHttpApiLive, type SchemaIdeServerOptions } from "./http-api";
import {
  LocalDebugOpenRouterClientLive,
  OpenRouterClientLive,
  type OpenRouterClientOptions,
} from "./openrouter-client";

export interface SchemaIdeNodeServerOptions
  extends SchemaIdeServerOptions, Omit<OpenRouterClientOptions, "apiKey"> {
  readonly openRouterApiKey?: string | undefined;
  readonly port?: number | undefined;
  readonly staticDir?: string | undefined;
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
  return HttpRouter.toWebHandler(
    apiLayer.pipe(
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

async function tryServeStatic(
  req: IncomingMessage,
  res: ServerResponse,
  staticDir: string | undefined,
  port: number,
): Promise<boolean> {
  if (!staticDir || (req.method !== "GET" && req.method !== "HEAD")) return false;

  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (url.pathname.startsWith("/v1")) return false;

  const root = resolve(staticDir);
  const filePath = resolveStaticFile(root, url.pathname);
  if (!filePath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return true;
  }

  const found = await findStaticFile(root, filePath, url.pathname);
  if (!found) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return true;
  }

  res.writeHead(200, {
    "Content-Type": contentTypeForPath(found),
  });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }

  await new Promise<void>((resolvePromise, reject) => {
    createReadStream(found).once("error", reject).once("end", resolvePromise).pipe(res);
  });
  return true;
}

function resolveStaticFile(root: string, pathname: string): string | null {
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const candidate = resolve(root, `.${decodedPathname}`);
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : null;
}

async function findStaticFile(
  root: string,
  filePath: string,
  pathname: string,
): Promise<string | null> {
  const file = await statFile(filePath);
  if (file?.isFile()) return filePath;
  if (file?.isDirectory()) {
    const indexPath = join(filePath, "index.html");
    if ((await statFile(indexPath))?.isFile()) return indexPath;
  }

  if (!extname(pathname)) {
    const fallbackPath = join(root, "index.html");
    if ((await statFile(fallbackPath))?.isFile()) return fallbackPath;
  }

  return null;
}

async function statFile(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

function contentTypeForPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
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
