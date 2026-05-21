import { Etag, HttpRouter, HttpServer, HttpServerResponse } from "effect/unstable/http";
import { Layer } from "effect";
import { makeSchemaIdeAppLayer } from "../packages/server/src/app.ts";

interface SchemaIdeWorkerEnv {
  readonly OPENROUTER_API_KEY?: string | undefined;
  readonly OPENROUTER_API_URL?: string | undefined;
  readonly SCHEMA_IDE_REFERER?: string | undefined;
  readonly SCHEMA_IDE_TITLE?: string | undefined;
}

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1";
const DEFAULT_REFERER = "https://schema-ide.pages.dev";
const DEFAULT_TITLE = "Schema IDE Playground";

let cachedEnv: SchemaIdeWorkerEnv | null = null;
let cachedHandler: ((request: Request) => Promise<Response>) | null = null;

export default {
  fetch(request: Request, env: SchemaIdeWorkerEnv): Promise<Response> {
    return getHandler(env)(request);
  },
};

function getHandler(env: SchemaIdeWorkerEnv): (request: Request) => Promise<Response> {
  if (cachedHandler && cachedEnv === env) return cachedHandler;
  cachedEnv = env;
  cachedHandler = HttpRouter.toWebHandler(
    Layer.mergeAll(
      ApiRootRoute,
      makeSchemaIdeAppLayer({
        openRouterApiKey: cleanEnvValue(env.OPENROUTER_API_KEY),
        apiUrl: cleanEnvValue(env.OPENROUTER_API_URL) ?? OPENROUTER_API_URL,
        referer: cleanEnvValue(env.SCHEMA_IDE_REFERER) ?? DEFAULT_REFERER,
        title: cleanEnvValue(env.SCHEMA_IDE_TITLE) ?? DEFAULT_TITLE,
      }),
    ).pipe(
      Layer.provide([Etag.layer, HttpServer.layerServices]),
      Layer.provide(
        HttpRouter.cors({
          allowedOrigins: ["*"],
          allowedMethods: ["GET", "POST", "OPTIONS"],
          allowedHeaders: ["Content-Type", "Traceparent"],
          exposedHeaders: ["content-type", "traceparent"],
          maxAge: 86_400,
        }),
      ),
    ),
  ).handler;
  return cachedHandler;
}

const ApiRootRoute = HttpRouter.add(
  "GET",
  "/",
  HttpServerResponse.jsonUnsafe({
    ok: true,
    service: "Schema IDE API",
    endpoints: {
      health: "/v1/healthz",
      chat: "/v1/chat",
      models: "/v1/models",
    },
  }),
);

function cleanEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
