#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeFileSystem, NodeRuntime } from "@effect/platform-node";
import { Config, ConfigProvider, Effect, FileSystem, Option } from "effect";
import { runSchemaIdeHttpServer } from "./node";

const repoEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env");

const optionalString = (name: string) => Config.option(Config.string(name));

const ServerConfig = Config.all({
  openRouterApiKey: optionalString("OPENROUTER_API_KEY"),
  legacyOpenRouterApiKey: optionalString("SCHEMA_IDE_OPENROUTER_API_KEY"),
  port: Config.withDefault(Config.port("SCHEMA_IDE_PORT"), 4317),
  referer: Config.withDefault(Config.string("SCHEMA_IDE_REFERER"), "http://127.0.0.1:4318"),
  staticDir: optionalString("SCHEMA_IDE_STATIC_DIR"),
  title: Config.withDefault(Config.string("SCHEMA_IDE_TITLE"), "Schema IDE Playground"),
});

const loadConfig = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
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
}).pipe(Effect.provide(NodeFileSystem.layer));

const program = Effect.scoped(
  Effect.gen(function* () {
    const config = yield* loadConfig;
    const apiKey = Option.getOrUndefined(
      Option.orElse(config.openRouterApiKey, () => config.legacyOpenRouterApiKey),
    );
    const staticDir = Option.getOrUndefined(config.staticDir);

    if (!apiKey) {
      yield* Effect.logWarning(
        "Schema IDE server is using the local debug chat adapter. Set OPENROUTER_API_KEY to use OpenRouter.",
      );
    }

    const server = yield* Effect.acquireRelease(
      Effect.promise(() =>
        runSchemaIdeHttpServer({
          openRouterApiKey: apiKey,
          port: config.port,
          referer: config.referer,
          staticDir,
          title: config.title,
        }),
      ),
      (server) => Effect.promise(() => server.close()).pipe(Effect.catchCause(() => Effect.void)),
    );

    yield* Effect.sync(() => {
      console.log(`Schema IDE HTTP server listening on http://127.0.0.1:${server.port}/v1`);
      if (staticDir) {
        console.log(`Schema IDE playground listening on http://127.0.0.1:${server.port}/`);
      }
    });

    yield* Effect.never;
  }),
);

NodeRuntime.runMain(program);
