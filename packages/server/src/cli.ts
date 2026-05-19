#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeFileSystem } from "@effect/platform-node";
import { Config, ConfigProvider, Effect, Option } from "effect";
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

const config = await Effect.runPromise(
  ServerConfig.pipe(
    Effect.provide(
      ConfigProvider.layerAdd(ConfigProvider.fromDotEnv({ path: repoEnvPath }), {
        asPrimary: true,
      }),
    ),
    Effect.provide(NodeFileSystem.layer),
  ),
);

const apiKey = Option.getOrUndefined(
  Option.orElse(config.openRouterApiKey, () => config.legacyOpenRouterApiKey),
);
const staticDir = Option.getOrUndefined(config.staticDir);

if (!apiKey) {
  console.warn(
    "Schema IDE server is using the local debug chat adapter. Set OPENROUTER_API_KEY to use OpenRouter.",
  );
}

const server = await runSchemaIdeHttpServer({
  openRouterApiKey: apiKey,
  port: config.port,
  referer: config.referer,
  staticDir,
  title: config.title,
});

console.log(`Schema IDE HTTP server listening on http://127.0.0.1:${server.port}/v1`);
if (staticDir) {
  console.log(`Schema IDE playground listening on http://127.0.0.1:${server.port}/`);
}

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await server.close();
};

process.on("SIGINT", () => {
  void close().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void close().finally(() => process.exit(0));
});

await new Promise(() => {});
