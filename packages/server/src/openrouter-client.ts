import { Context, Effect, Layer, Redacted, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import {
  OpenRouterChatCompletionResponseSchema,
  type OpenRouterChatCompletionResponse,
  type OpenRouterChatRequest,
  SchematicsServerError,
  SchematicsUpstreamError,
} from "@schematics/protocol";

export interface OpenRouterClientOptions {
  readonly apiKey: string;
  readonly apiUrl?: string | undefined;
  readonly referer?: string | undefined;
  readonly title?: string | undefined;
}

export interface OpenRouterClientService {
  readonly complete: (
    request: OpenRouterChatRequest,
  ) => Effect.Effect<
    OpenRouterChatCompletionResponse,
    SchematicsServerError | SchematicsUpstreamError
  >;
}

export class OpenRouterClient extends Context.Service<OpenRouterClient, OpenRouterClientService>()(
  "schematics/OpenRouterClient",
) {}

export const makeOpenRouterClient = (options: OpenRouterClientOptions): OpenRouterClientService => {
  const apiUrl = options.apiUrl ?? "https://openrouter.ai/api/v1";
  const referer = options.referer ?? "https://schematics.local";
  const title = options.title ?? "Schematics";

  return {
    complete: (payload) =>
      Effect.gen(function* () {
        const httpClient = yield* HttpClient.HttpClient;
        const baseRequest = HttpClientRequest.post(`${apiUrl}/chat/completions`);
        const requestWithBody = yield* HttpClientRequest.bodyJson(baseRequest, payload).pipe(
          Effect.mapError(
            (error) =>
              new SchematicsServerError({
                message: `Failed to serialize OpenRouter request: ${String(error)}`,
              }),
          ),
        );
        const request = requestWithBody.pipe(
          HttpClientRequest.bearerToken(Redacted.make(options.apiKey)),
          HttpClientRequest.setHeader("HTTP-Referer", referer),
          HttpClientRequest.setHeader("X-Title", title),
        );

        const response = yield* httpClient.execute(request).pipe(
          Effect.mapError(
            (error) =>
              new SchematicsUpstreamError({
                message: `Failed to call OpenRouter: ${String(error)}`,
              }),
          ),
        );

        if (response.status >= 400) {
          const body = yield* response.text.pipe(
            Effect.catch(() => Effect.succeed("Unable to read upstream error response.")),
          );
          return yield* Effect.fail(
            new SchematicsUpstreamError({
              message: `OpenRouter API error (${response.status}): ${body}`,
              upstreamStatus: response.status,
            }),
          );
        }

        const responseJson = yield* response.json.pipe(
          Effect.mapError(
            (error) =>
              new SchematicsUpstreamError({
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
              new SchematicsUpstreamError({
                message: `OpenRouter response did not match the Schematics protocol: ${error.message}`,
                upstreamStatus: response.status,
              }),
          ),
        );
      }).pipe(Effect.provide(FetchHttpClient.layer)),
  };
};

export const OpenRouterClientLive = (options: OpenRouterClientOptions) =>
  Layer.succeed(OpenRouterClient, makeOpenRouterClient(options));

export interface DebugOpenRouterClientOptions {
  readonly runtimeName?: string | undefined;
  readonly credentialHint?: string | undefined;
}

export const makeLocalDebugOpenRouterClient = (
  options: DebugOpenRouterClientOptions = {},
): OpenRouterClientService => ({
  complete: (request) => {
    const runtimeName = options.runtimeName ?? "Local Schematics server";
    const credentialHint = options.credentialHint ?? "Set OPENROUTER_API_KEY to use a real model.";
    let prompt = "";
    for (const message of request.messages) {
      if (message.role === "user") prompt = message.content.trim();
    }
    const content = [
      `${runtimeName} is running in debug chat mode.`,
      "This response is deterministic and did not call a model.",
      prompt ? `Received: ${prompt.slice(0, 240)}` : "No user message was provided.",
      credentialHint,
    ].join("\n\n");

    return Effect.succeed({
      choices: [{ message: { role: "assistant" as const, content } }],
    });
  },
});

export const LocalDebugOpenRouterClientLive = (options: DebugOpenRouterClientOptions = {}) =>
  Layer.succeed(OpenRouterClient, makeLocalDebugOpenRouterClient(options));
