import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import {
  SCHEMA_IDE_OPENROUTER_MODELS,
  SchemaIdeHttpApi,
  type SchemaIdeModel,
  type SchemaIdeModelsResponse,
} from "@schema-ide/protocol";
import { OpenRouterClient } from "./openrouter-client.ts";

export const DEFAULT_SCHEMA_IDE_MODELS: readonly SchemaIdeModel[] = SCHEMA_IDE_OPENROUTER_MODELS;

export interface SchemaIdeServerOptions {
  readonly models?: readonly SchemaIdeModel[] | undefined;
}

export const makeSchemaIdeChatApiLive = (options: SchemaIdeServerOptions = {}) =>
  HttpApiBuilder.group(SchemaIdeHttpApi, "chat", (handlers) =>
    Effect.gen(function* () {
      const openRouter = yield* OpenRouterClient;
      const models: SchemaIdeModelsResponse = {
        models: [...(options.models ?? DEFAULT_SCHEMA_IDE_MODELS)],
      };

      return handlers
        .handle("complete", ({ payload }) => openRouter.complete(payload))
        .handle("stream", ({ payload }) =>
          openRouter.complete(payload).pipe(Effect.map((response) => JSON.stringify(response))),
        )
        .handle("models", () => Effect.succeed(models))
        .handle("health", () => Effect.succeed({ ok: true as const }));
    }),
  );

export const makeSchemaIdeHttpApiLive = (options: SchemaIdeServerOptions = {}) =>
  HttpApiBuilder.layer(SchemaIdeHttpApi).pipe(Layer.provide(makeSchemaIdeChatApiLive(options)));
