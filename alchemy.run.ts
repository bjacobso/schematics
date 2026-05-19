import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

const playgroundApiBaseUrl =
  process.env["VITE_SCHEMA_IDE_API_BASE_URL"] ?? process.env["SCHEMA_IDE_API_BASE_URL"] ?? "";

export default Alchemy.Stack(
  "schema-ide",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const playground = yield* Cloudflare.Vite("Playground", {
      rootDir: "./apps/playground",
      env: {
        VITE_SCHEMA_IDE_API_BASE_URL: playgroundApiBaseUrl,
      },
      memo: {
        include: [
          "apps/playground/**",
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
      playgroundUrl: playground.url,
      playgroundApiBaseUrl: playgroundApiBaseUrl || "(relative /v1)",
    };
  }),
);
