import * as Cloudflare from "alchemy/Cloudflare";
import {
  Config,
  ConfigProvider,
  Context,
  Effect,
  Layer,
  Option,
  Path,
  Redacted,
  Schema,
} from "effect";
import {
  Etag,
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpPlatform,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiBuilder } from "effect/unstable/httpapi";
import {
  OpenRouterChatCompletionResponseSchema,
  OpenRouterChatRequestSchema,
  SCHEMA_IDE_OPENROUTER_MODELS,
  SchemaIdeHealthResponseSchema,
  SchemaIdeModelsResponseSchema,
  type OpenRouterChatCompletionResponse,
  type OpenRouterChatRequest,
} from "../packages/protocol/src/chat.ts";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1";
const DEFAULT_REFERER = "https://schema-ide.pages.dev";
const DEFAULT_TITLE = "Schema IDE Playground";

const optionalRedacted = (name: string) => Config.option(Config.redacted(name));

const SchemaIdeWorkerConfig = Config.all({
  openRouterApiKey: optionalRedacted("OPENROUTER_API_KEY"),
  apiUrl: Config.withDefault(Config.string("OPENROUTER_API_URL"), OPENROUTER_API_URL),
  referer: Config.withDefault(Config.string("SCHEMA_IDE_REFERER"), DEFAULT_REFERER),
  title: Config.withDefault(Config.string("SCHEMA_IDE_TITLE"), DEFAULT_TITLE),
});

export default Cloudflare.Worker(
  "Api",
  SchemaIdeWorkerConfig.pipe(
    Effect.map((config) => ({
      main: import.meta.filename,
      env: {
        OPENROUTER_API_KEY: Option.getOrElse(config.openRouterApiKey, () => ""),
        OPENROUTER_API_URL: config.apiUrl,
        SCHEMA_IDE_REFERER: config.referer,
        SCHEMA_IDE_TITLE: config.title,
      },
    })),
    Effect.orDie,
  ),
  Effect.gen(function* () {
    const openRouterClientLive = Layer.effect(
      OpenRouterClient,
      Effect.gen(function* () {
        const config = yield* RuntimeWorkerConfig.pipe(Effect.orDie);
        const apiKey = Option.getOrUndefined(config.openRouterApiKey);

        if (!apiKey || Redacted.value(apiKey).trim().length === 0) {
          return makeLocalDebugOpenRouterClient();
        }

        return makeOpenRouterClient({
          apiKey: Redacted.value(apiKey),
          apiUrl: config.apiUrl,
          referer: config.referer,
          title: config.title,
        });
      }),
    );

    return {
      fetch: HttpRouter.toHttpEffect(
        Layer.mergeAll(ApiRootRoute, HttpApiLayer).pipe(
          Layer.provide(makeSchemaIdeChatApiLive()),
          Layer.provide(openRouterClientLive),
          Layer.provide([Etag.layer, HttpPlatformStub, Path.layer]),
        ),
      ).pipe(Effect.map(withCorsHeaders)),
    };
  }),
);

const RuntimeWorkerConfig = Effect.gen(function* () {
  const env = yield* Cloudflare.WorkerEnvironment;
  return yield* SchemaIdeWorkerConfig.pipe(
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: normalizeWorkerEnv(env) }))),
  );
});

const normalizeWorkerEnv = (env: Record<string, unknown>): Record<string, string> => {
  const normalized: Record<string, string> = {};
  for (const key of [
    "OPENROUTER_API_KEY",
    "OPENROUTER_API_URL",
    "SCHEMA_IDE_REFERER",
    "SCHEMA_IDE_TITLE",
  ]) {
    normalized[key] = getWorkerEnvString(env, key);
  }
  return normalized;
};

const getWorkerEnvString = (env: Record<string, unknown>, key: string): string => {
  const value = env[key];
  if (typeof value === "string") return value.trim();
  if (Redacted.isRedacted(value)) {
    const redactedValue = Redacted.value(value);
    return typeof redactedValue === "string" ? redactedValue.trim() : "";
  }
  return "";
};

class SchemaIdeServerError extends Schema.TaggedErrorClass<SchemaIdeServerError>()(
  "SchemaIdeServerError",
  { message: Schema.String },
  { httpApiStatus: 500 },
) {}

class SchemaIdeUpstreamError extends Schema.TaggedErrorClass<SchemaIdeUpstreamError>()(
  "SchemaIdeUpstreamError",
  {
    message: Schema.String,
    upstreamStatus: Schema.optional(Schema.Number),
  },
  { httpApiStatus: 502 },
) {}

class SchemaIdeChatApiGroup extends HttpApiGroup.make("chat")
  .add(
    HttpApiEndpoint.post("complete", "/chat", {
      payload: OpenRouterChatRequestSchema,
      success: OpenRouterChatCompletionResponseSchema,
      error: [SchemaIdeServerError, SchemaIdeUpstreamError],
    }),
  )
  .add(
    HttpApiEndpoint.post("stream", "/chat/stream", {
      payload: OpenRouterChatRequestSchema,
      success: Schema.String,
      error: [SchemaIdeServerError, SchemaIdeUpstreamError],
    }),
  )
  .add(
    HttpApiEndpoint.get("models", "/models", {
      success: SchemaIdeModelsResponseSchema,
    }),
  )
  .add(
    HttpApiEndpoint.get("health", "/healthz", {
      success: SchemaIdeHealthResponseSchema,
    }),
  ) {}

class SchemaIdeHttpApi extends HttpApi.make("SchemaIdeHttpApi")
  .add(SchemaIdeChatApiGroup)
  .prefix("/v1") {}

const HttpApiLayer = HttpApiBuilder.layer(SchemaIdeHttpApi);

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

interface OpenRouterClientService {
  readonly complete: (
    request: OpenRouterChatRequest,
  ) => Effect.Effect<
    OpenRouterChatCompletionResponse,
    SchemaIdeServerError | SchemaIdeUpstreamError
  >;
}

class OpenRouterClient extends Context.Service<OpenRouterClient, OpenRouterClientService>()(
  "schema-ide/OpenRouterClient",
) {}

const makeSchemaIdeChatApiLive = () =>
  HttpApiBuilder.group(SchemaIdeHttpApi, "chat", (handlers) =>
    Effect.gen(function* () {
      const openRouter = yield* OpenRouterClient;

      return handlers
        .handle("complete", ({ payload }) => openRouter.complete(payload))
        .handle("stream", ({ payload }) =>
          openRouter.complete(payload).pipe(Effect.map((response) => JSON.stringify(response))),
        )
        .handle("models", () =>
          Effect.succeed({
            models: [...SCHEMA_IDE_OPENROUTER_MODELS],
          }),
        )
        .handle("health", () => Effect.succeed({ ok: true as const }));
    }),
  );

const makeOpenRouterClient = (options: {
  readonly apiKey: string;
  readonly apiUrl: string;
  readonly referer: string;
  readonly title: string;
}): OpenRouterClientService => ({
  complete: (payload) =>
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const baseRequest = HttpClientRequest.post(`${options.apiUrl}/chat/completions`);
      const requestWithBody = yield* HttpClientRequest.bodyJson(baseRequest, payload).pipe(
        Effect.mapError(
          (error) =>
            new SchemaIdeServerError({
              message: `Failed to serialize OpenRouter request: ${String(error)}`,
            }),
        ),
      );
      const request = requestWithBody.pipe(
        HttpClientRequest.bearerToken(Redacted.make(options.apiKey)),
        HttpClientRequest.setHeader("HTTP-Referer", options.referer),
        HttpClientRequest.setHeader("X-Title", options.title),
      );

      const response = yield* httpClient.execute(request).pipe(
        Effect.mapError(
          (error) =>
            new SchemaIdeUpstreamError({
              message: `Failed to call OpenRouter: ${String(error)}`,
            }),
        ),
      );

      if (response.status >= 400) {
        const body = yield* response.text.pipe(
          Effect.catch(() => Effect.succeed("Unable to read upstream error response.")),
        );
        return yield* Effect.fail(
          new SchemaIdeUpstreamError({
            message: `OpenRouter API error (${response.status}): ${body}`,
            upstreamStatus: response.status,
          }),
        );
      }

      const responseJson = yield* response.json.pipe(
        Effect.mapError(
          (error) =>
            new SchemaIdeUpstreamError({
              message: `Failed to parse OpenRouter response: ${String(error)}`,
              upstreamStatus: response.status,
            }),
        ),
      );

      return yield* Schema.decodeUnknownEffect(OpenRouterChatCompletionResponseSchema)(
        responseJson,
      ).pipe(
        Effect.mapError(
          (error) =>
            new SchemaIdeUpstreamError({
              message: `OpenRouter response did not match the Schema IDE protocol: ${error.message}`,
              upstreamStatus: response.status,
            }),
        ),
      );
    }).pipe(Effect.provide(FetchHttpClient.layer)),
});

const makeLocalDebugOpenRouterClient = (): OpenRouterClientService => ({
  complete: (request) => {
    let prompt = "";
    for (const message of request.messages) {
      if (message.role === "user") prompt = message.content.trim();
    }
    const content = [
      "Local Schema IDE debug server is running.",
      prompt ? `Received: ${prompt.slice(0, 240)}` : "No user message was provided.",
      "Set OPENROUTER_API_KEY to use a real model.",
    ].join("\n\n");

    return Effect.succeed({
      choices: [{ message: { role: "assistant" as const, content } }],
    });
  },
});

const corsOptions = {
  allowedMethods: ["GET", "POST", "OPTIONS"],
  exposedHeaders: ["content-type", "traceparent"],
  maxAge: 86_400,
};

const withCorsHeaders = <E, R>(
  httpApp: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  R | HttpServerRequest.HttpServerRequest
> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const responseHeaders =
      request.method === "OPTIONS" ? corsPreflightHeaders(request) : corsResponseHeaders(request);

    if (request.method === "OPTIONS") {
      return HttpServerResponse.empty({
        status: 204,
        headers: responseHeaders,
      });
    }

    return yield* httpApp.pipe(
      Effect.map((response) => HttpServerResponse.setHeaders(response, responseHeaders)),
      Effect.catchCause(() =>
        Effect.succeed(
          HttpServerResponse.text("Internal Server Error", {
            status: 500,
            headers: responseHeaders,
          }),
        ),
      ),
    );
  });

const corsResponseHeaders = (request: HttpServerRequest.HttpServerRequest) => {
  const origin = request.headers["origin"];
  return {
    "access-control-allow-origin": origin ?? "*",
    ...(origin ? { vary: "Origin" } : {}),
    "access-control-expose-headers": corsOptions.exposedHeaders.join(","),
  };
};

const corsPreflightHeaders = (request: HttpServerRequest.HttpServerRequest) => ({
  ...corsResponseHeaders(request),
  "access-control-allow-methods": corsOptions.allowedMethods.join(", "),
  "access-control-allow-headers":
    request.headers["access-control-request-headers"] ?? "content-type,traceparent",
  "access-control-max-age": String(corsOptions.maxAge),
});

const HttpPlatformStub = Layer.succeed(HttpPlatform.HttpPlatform, {
  fileResponse: () => Effect.die("HttpPlatform.fileResponse is not supported in this worker"),
  fileWebResponse: () => Effect.die("HttpPlatform.fileWebResponse is not supported in this worker"),
});
