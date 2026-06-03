import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import {
  OpenRouterChatCompletionResponseSchema,
  OpenRouterChatRequestSchema,
  SchematicsHealthResponseSchema,
  SchematicsModelsResponseSchema,
} from "./chat";

export class SchematicsServerError extends Schema.TaggedErrorClass<SchematicsServerError>()(
  "SchematicsServerError",
  { message: Schema.String },
  { httpApiStatus: 500 },
) {}

export class SchematicsUpstreamError extends Schema.TaggedErrorClass<SchematicsUpstreamError>()(
  "SchematicsUpstreamError",
  {
    message: Schema.String,
    upstreamStatus: Schema.optional(Schema.Number),
  },
  { httpApiStatus: 502 },
) {}

export class SchematicsChatApiGroup extends HttpApiGroup.make("chat")
  .add(
    HttpApiEndpoint.post("complete", "/chat", {
      payload: OpenRouterChatRequestSchema,
      success: OpenRouterChatCompletionResponseSchema,
      error: [SchematicsServerError, SchematicsUpstreamError],
    }),
  )
  .add(
    HttpApiEndpoint.post("stream", "/chat/stream", {
      payload: OpenRouterChatRequestSchema,
      success: Schema.String,
      error: [SchematicsServerError, SchematicsUpstreamError],
    }),
  )
  .add(
    HttpApiEndpoint.get("models", "/models", {
      success: SchematicsModelsResponseSchema,
    }),
  )
  .add(
    HttpApiEndpoint.get("health", "/healthz", {
      success: SchematicsHealthResponseSchema,
    }),
  ) {}

export class SchematicsHttpApi extends HttpApi.make("SchematicsHttpApi")
  .add(SchematicsChatApiGroup)
  .prefix("/v1") {}
