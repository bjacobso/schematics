import { Effect, Layer, Schema, Stream } from "effect";
import { AiError, IdGenerator, LanguageModel, Response } from "effect/unstable/ai";
import {
  OpenRouterChatCompletionResponseSchema,
  SCHEMATICS_DEFAULT_OPENROUTER_MODEL,
  type OpenRouterChatCompletionResponse,
  type OpenRouterChatRequest,
  type OpenRouterMessage,
  type OpenRouterUserMessageContent,
} from "@schematics/protocol";

type OpenRouterUserContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image_url"; readonly image_url: { readonly url: string } };

export interface OpenRouterLanguageModelLayerOptions {
  readonly apiKey: string;
  readonly model?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly referer?: string | undefined;
  readonly title?: string | undefined;
}

export interface OpenRouterLanguageModelProxyLayerOptions {
  readonly proxyUrl?: string | undefined;
  readonly model?: string | undefined;
}

export interface MockOpenRouterLanguageModelOptions {
  readonly model?: string | undefined;
  readonly text?: string | undefined;
  readonly object?: unknown | undefined;
}

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_PROXY_URL = "/v1/chat";

export const OpenRouterLanguageModel = {
  layer: (options: OpenRouterLanguageModelLayerOptions) =>
    languageModelLayer({
      model: options.model,
      complete: (request) =>
        fetchOpenRouterCompletion(
          `${options.baseUrl ?? DEFAULT_OPENROUTER_BASE_URL}/chat/completions`,
          request,
          {
            Authorization: `Bearer ${options.apiKey}`,
            "HTTP-Referer": options.referer ?? "https://schematics.local",
            "X-Title": options.title ?? "Schematics",
          },
        ),
    }),

  layerProxy: (options: OpenRouterLanguageModelProxyLayerOptions = {}) =>
    languageModelLayer({
      model: options.model,
      complete: (request) =>
        fetchOpenRouterCompletion(options.proxyUrl ?? DEFAULT_PROXY_URL, request),
    }),

  layerMock: (options: MockOpenRouterLanguageModelOptions = {}) =>
    languageModelLayer({
      model: options.model,
      complete: (request, responseFormat) =>
        Effect.succeed({
          choices: [
            {
              message: {
                role: "assistant" as const,
                content:
                  responseFormat.type === "json"
                    ? JSON.stringify(options.object ?? { ok: true })
                    : (options.text ?? `mock:${lastUserMessage(request.messages)}`),
              },
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }),
    }),
} as const;

function languageModelLayer(options: {
  readonly model?: string | undefined;
  readonly complete: (
    request: OpenRouterChatRequest,
    responseFormat: LanguageModel.ProviderOptions["responseFormat"],
  ) => Effect.Effect<OpenRouterChatCompletionResponse, AiError.AiError>;
}) {
  const service = LanguageModel.make({
    generateText: (providerOptions) =>
      options
        .complete(
          toOpenRouterRequest(providerOptions, options.model),
          providerOptions.responseFormat,
        )
        .pipe(Effect.map((response) => toResponseParts(response))),
    streamText: (providerOptions) =>
      Stream.fromEffect(
        options
          .complete(
            toOpenRouterRequest(providerOptions, options.model),
            providerOptions.responseFormat,
          )
          .pipe(Effect.map((response) => toStreamParts(response))),
      ).pipe(Stream.flatMap((parts) => Stream.fromIterable(parts))),
  }).pipe(Effect.provideService(IdGenerator.IdGenerator, IdGenerator.defaultIdGenerator));

  return Layer.effect(LanguageModel.LanguageModel, service);
}

function fetchOpenRouterCompletion(
  url: string,
  request: OpenRouterChatRequest,
  headers: Readonly<Record<string, string>> = {},
): Effect.Effect<OpenRouterChatCompletionResponse, AiError.AiError> {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        throw new Error(`OpenRouter request failed (${response.status}): ${await response.text()}`);
      }
      return Schema.decodeUnknownSync(OpenRouterChatCompletionResponseSchema)(
        await response.json(),
      );
    },
    catch: (error) =>
      AiError.make({
        module: "OpenRouter",
        method: "chat.completions",
        reason: new AiError.UnknownError({
          description: error instanceof Error ? error.message : String(error),
        }),
      }),
  });
}

function toOpenRouterRequest(
  options: LanguageModel.ProviderOptions,
  model: string = SCHEMATICS_DEFAULT_OPENROUTER_MODEL,
): OpenRouterChatRequest {
  const messages = promptToOpenRouterMessages(options.prompt);
  if (options.responseFormat.type === "json") {
    messages.push({
      role: "system",
      content: `Return only a valid JSON object for ${options.responseFormat.objectName}.`,
    });
  }
  return {
    model,
    messages,
  };
}

function promptToOpenRouterMessages(
  prompt: LanguageModel.ProviderOptions["prompt"],
): OpenRouterMessage[] {
  return prompt.content.map((message) => {
    switch (message.role) {
      case "system":
        return { role: "system", content: contentText(message.content) };
      case "assistant":
        return { role: "assistant", content: contentText(message.content) };
      case "tool":
        return {
          role: "tool",
          tool_call_id: firstToolResultId(message.content),
          content: contentText(message.content),
        };
      case "user":
        return { role: "user", content: userContent(message.content) };
    }
  });
}

function firstToolResultId(
  content: LanguageModel.ProviderOptions["prompt"]["content"][number]["content"],
): string {
  if (!Array.isArray(content)) return "tool";
  const part = content.find((item) => item.type === "tool-result");
  return part?.id ?? "tool";
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "object" && part !== null && "text" in part
          ? String((part as { readonly text: unknown }).text)
          : "",
      )
      .join("");
  }
  return JSON.stringify(content);
}

function userContent(content: unknown): OpenRouterUserMessageContent {
  if (!Array.isArray(content)) return contentText(content);

  const parts = content.flatMap((part): readonly OpenRouterUserContentPart[] => {
    if (typeof part !== "object" || part === null) {
      const text = String(part);
      return text ? [{ type: "text", text }] : [];
    }
    const record = part as Readonly<Record<string, unknown>>;
    if (typeof record["text"] === "string") {
      return [{ type: "text", text: record["text"] }];
    }
    const image = imageUrlContentPart(record);
    return image ? [image] : [];
  });

  if (parts.length === 0) return "";
  if (parts.every((part) => part.type === "text")) {
    return parts.map((part) => (part.type === "text" ? part.text : "")).join("");
  }
  return parts as OpenRouterUserMessageContent;
}

function imageUrlContentPart(
  record: Readonly<Record<string, unknown>>,
): { readonly type: "image_url"; readonly image_url: { readonly url: string } } | null {
  const mediaType = stringField(record, "mediaType") ?? stringField(record, "mimeType");
  if (mediaType && !mediaType.startsWith("image/")) return null;
  const url = stringField(record, "url");
  if (url) {
    return {
      type: "image_url",
      image_url: { url },
    };
  }

  const content = record["content"] ?? record["data"] ?? record["bytes"];
  const base64 = contentToBase64(content);
  if (!base64) return null;
  return {
    type: "image_url",
    image_url: { url: `data:${mediaType ?? "image/png"};base64,${base64}` },
  };
}

function stringField(record: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function contentToBase64(content: unknown): string | null {
  if (typeof content === "string") {
    const dataUrl = content.match(/^data:[^,]+;base64,([\s\S]*)$/i);
    return (dataUrl?.[1] ?? content).replace(/\s+/g, "");
  }
  if (content instanceof Uint8Array) return bytesToBase64(content);
  if (content instanceof ArrayBuffer) return bytesToBase64(new Uint8Array(content));
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toResponseParts(response: OpenRouterChatCompletionResponse): Response.PartEncoded[] {
  const message = response.choices[0]?.message;
  const text = message?.content ?? "";
  return [
    { type: "text", text },
    {
      type: "finish",
      reason: "stop",
      response: undefined,
      usage: {
        inputTokens: {
          uncached: undefined,
          total: response.usage?.prompt_tokens,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: response.usage?.completion_tokens,
          text: response.usage?.completion_tokens,
          reasoning: undefined,
        },
      },
    },
  ];
}

function toStreamParts(response: OpenRouterChatCompletionResponse): Response.StreamPartEncoded[] {
  const message = response.choices[0]?.message;
  const text = message?.content ?? "";
  return [
    { type: "text-start", id: "text" },
    { type: "text-delta", id: "text", delta: text },
    { type: "text-end", id: "text" },
    {
      type: "finish",
      reason: "stop",
      response: undefined,
      usage: {
        inputTokens: {
          uncached: undefined,
          total: response.usage?.prompt_tokens,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: response.usage?.completion_tokens,
          text: response.usage?.completion_tokens,
          reasoning: undefined,
        },
      },
    },
  ];
}

function lastUserMessage(messages: readonly OpenRouterMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      const content = message.content as OpenRouterUserMessageContent;
      return typeof content === "string"
        ? content
        : content.map((part) => (part.type === "text" ? part.text : "[image]")).join("");
    }
  }
  return "";
}
