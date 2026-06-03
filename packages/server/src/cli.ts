#!/usr/bin/env node
import { NodeFileSystem, NodePath, NodeRuntime } from "@effect/platform-node";
import { Config, ConfigProvider, Effect, FileSystem, Layer, Option, Path } from "effect";
import { runSchematicsHttpServer } from "./node";

const NodeCliLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer);

const optionalString = (name: string) => Config.option(Config.string(name));

const ServerConfig = Config.all({
  openRouterApiKey: optionalString("OPENROUTER_API_KEY"),
  legacyOpenRouterApiKey: optionalString("SCHEMATICS_OPENROUTER_API_KEY"),
  port: Config.withDefault(Config.port("SCHEMATICS_PORT"), 4317),
  referer: Config.withDefault(Config.string("SCHEMATICS_REFERER"), "http://127.0.0.1:4318"),
  staticDir: optionalString("SCHEMATICS_STATIC_DIR"),
  title: Config.withDefault(Config.string("SCHEMATICS_TITLE"), "Schematics Playground"),
});

const loadConfig = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const modulePath = yield* path.fromFileUrl(new URL(import.meta.url));
  const repoEnvPath = path.resolve(path.dirname(modulePath), "../../../.env");
  const hasRepoEnv = yield* fs.exists(repoEnvPath);

  if (!hasRepoEnv) {
    return yield* ServerConfig;
  }

  return yield* ServerConfig.pipe(
    Effect.provide(
      ConfigProvider.layerAdd(ConfigProvider.fromDotEnv({ path: repoEnvPath }), {
        asPrimary: true,
      }),
    ),
  );
}).pipe(Effect.provide(NodeCliLayer));

const program = Effect.scoped(
  Effect.gen(function* () {
    const config = yield* loadConfig;
    const apiKey = Option.getOrUndefined(
      Option.orElse(config.openRouterApiKey, () => config.legacyOpenRouterApiKey),
    );
    const staticDir = Option.getOrUndefined(config.staticDir);

    if (!apiKey) {
      yield* Effect.logWarning(
        "Schematics local server is using debug chat mode. Set OPENROUTER_API_KEY or SCHEMATICS_OPENROUTER_API_KEY to use OpenRouter.",
      );
    }

    const server = yield* Effect.acquireRelease(
      Effect.promise(() =>
        runSchematicsHttpServer({
          openRouterApiKey: apiKey,
          port: config.port,
          referer: config.referer,
          staticDir,
          title: config.title,
          debugChat: {
            runtimeName: "Schematics local server",
            credentialHint:
              "Set OPENROUTER_API_KEY or SCHEMATICS_OPENROUTER_API_KEY in your shell or repo .env file to use OpenRouter.",
            modelLabel: "Local Debug",
          },
        }),
      ),
      (server) => Effect.promise(() => server.close()).pipe(Effect.catchCause(() => Effect.void)),
    );

    yield* Effect.sync(() => {
      console.log(`Schematics HTTP server listening on http://127.0.0.1:${server.port}/v1`);
      if (staticDir) {
        console.log(`Schematics playground listening on http://127.0.0.1:${server.port}/`);
      }
    });

    yield* Effect.never;
  }),
);

NodeRuntime.runMain(program);
