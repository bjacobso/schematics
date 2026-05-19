import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import {
  OpenRouterChatCompletionResponseSchema,
  OpenRouterChatRequestSchema,
  SchemaIdeHealthResponseSchema,
  SchemaIdeModelsResponseSchema,
} from "./chat";

export class SchemaIdeServerError extends Schema.TaggedErrorClass<SchemaIdeServerError>()(
  "SchemaIdeServerError",
  { message: Schema.String },
  { httpApiStatus: 500 },
) {}

export class SchemaIdeUpstreamError extends Schema.TaggedErrorClass<SchemaIdeUpstreamError>()(
  "SchemaIdeUpstreamError",
  {
    message: Schema.String,
    upstreamStatus: Schema.optional(Schema.Number),
  },
  { httpApiStatus: 502 },
) {}

export class SchemaIdeChatApiGroup extends HttpApiGroup.make("chat")
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

export class SchemaIdeHttpApi extends HttpApi.make("SchemaIdeHttpApi")
  .add(SchemaIdeChatApiGroup)
  .prefix("/v1") {}
