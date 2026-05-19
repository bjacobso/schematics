import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import ApiWorker from "./alchemy/schema-ide-api-worker.ts";

const playgroundApiBaseUrlOverride =
  process.env["VITE_SCHEMA_IDE_API_BASE_URL"] ?? process.env["SCHEMA_IDE_API_BASE_URL"] ?? "";

export default Alchemy.Stack(
  "schema-ide",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const api = yield* ApiWorker;
    const playgroundApiBaseUrl =
      playgroundApiBaseUrlOverride || api.url.pipe(Output.map((url) => url ?? ""));

    const playground = yield* Cloudflare.Vite("Playground", {
      rootDir: "./apps/playground",
      env: {
        VITE_SCHEMA_IDE_API_BASE_URL: playgroundApiBaseUrl,
      },
      memo: {
        include: [
          "apps/playground/**",
          "alchemy/**",
          "packages/*/src/**",
          "packages/*/package.json",
          "package.json",
          "pnpm-lock.yaml",
          "pnpm-workspace.yaml",
          "tsconfig.base.json",
          "vitest.aliases.ts",
        ],
      },
    });

    return {
      apiUrl: api.url,
      playgroundUrl: playground.url,
      playgroundApiBaseUrl:
        playgroundApiBaseUrlOverride || api.url.pipe(Output.map((url) => url ?? "(relative)")),
    };
  }),
);
