import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import {
  SCHEMATICS_OPENROUTER_MODELS,
  SchematicsHttpApi,
  type SchematicsModel,
  type SchematicsModelsResponse,
} from "@schematics/protocol";
import { OpenRouterClient } from "./openrouter-client.ts";

export const DEFAULT_SCHEMATICS_MODELS: readonly SchematicsModel[] = SCHEMATICS_OPENROUTER_MODELS;

export interface SchematicsServerOptions {
  readonly models?: readonly SchematicsModel[] | undefined;
}

export const makeSchematicsChatApiLive = (options: SchematicsServerOptions = {}) =>
  HttpApiBuilder.group(SchematicsHttpApi, "chat", (handlers) =>
    Effect.gen(function* () {
      const openRouter = yield* OpenRouterClient;
      const models: SchematicsModelsResponse = {
        models: [...(options.models ?? DEFAULT_SCHEMATICS_MODELS)],
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

export const makeSchematicsHttpApiLive = (options: SchematicsServerOptions = {}) =>
  HttpApiBuilder.layer(SchematicsHttpApi).pipe(Layer.provide(makeSchematicsChatApiLive(options)));
