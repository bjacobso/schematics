import * as Alchemy from "alchemy";
import type { StackServices } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import * as Output from "alchemy/Output";
import * as Provider from "alchemy/Provider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import ApiWorker from "./alchemy/schematics-api-worker.ts";

const playgroundApiBaseUrlOverride =
  process.env["VITE_SCHEMATICS_API_BASE_URL"] ?? process.env["SCHEMATICS_API_BASE_URL"] ?? "";
const pullRequestNumber = Number(process.env["PULL_REQUEST"] ?? "");
const shouldCommentOnPullRequest = Number.isInteger(pullRequestNumber) && pullRequestNumber > 0;
const commitLabel = process.env["GITHUB_SHA"]?.slice(0, 7) || "unknown";
const githubCommentProviders = Layer.effect(
  GitHub.Providers,
  Provider.collection([GitHub.Comment]),
).pipe(Layer.provide(GitHub.CommentProvider()));
type PreviewProviderRequirements = Cloudflare.ProviderRequirements | GitHub.Providers;
const providers: Layer.Layer<PreviewProviderRequirements, never, StackServices> =
  shouldCommentOnPullRequest
    ? Layer.mergeAll(Cloudflare.providers(), githubCommentProviders)
    : Cloudflare.providers();

export default Alchemy.Stack(
  "schematics",
  {
    providers,
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const api = yield* ApiWorker;
    const playgroundApiBaseUrl =
      playgroundApiBaseUrlOverride || api.url.pipe(Output.map((url) => url ?? ""));

    const playground = yield* Cloudflare.Vite("Playground", {
      rootDir: "./apps/playground",
      env: {
        VITE_SCHEMATICS_API_BASE_URL: playgroundApiBaseUrl,
      },
      assets: {
        config: {
          htmlHandling: "auto-trailing-slash",
          notFoundHandling: "single-page-application",
        },
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

    if (shouldCommentOnPullRequest) {
      const deployedAt = new Date().toISOString();
      yield* GitHub.Comment("preview-comment", {
        owner: "bjacobso",
        repository: "schematics",
        issueNumber: pullRequestNumber,
        body: Output.interpolate`
            ## Cloudflare Preview Deployed

            **Playground:** ${playground.url}
            **API:** ${api.url}

            Built from commit \`${commitLabel}\`

            ---
            <time datetime="${deployedAt}">${deployedAt}</time>

            <sub>This comment updates automatically with each push.</sub>
          `,
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            console.warn("Failed to post PR preview comment (non-fatal):", String(cause));
          }),
        ),
      );
    }

    return {
      apiUrl: api.url,
      playgroundUrl: playground.url,
      playgroundApiBaseUrl:
        playgroundApiBaseUrlOverride || api.url.pipe(Output.map((url) => url ?? "(relative)")),
    };
  }),
);
