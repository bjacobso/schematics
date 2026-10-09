import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import * as Output from "alchemy/Output";
import * as Provider from "alchemy/Provider";
import { Stage } from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import ApiWorker from "./alchemy/schematics-api-worker.ts";
import { playgroundMemo } from "./alchemy/playground-memo.ts";
import {
  PROD_API_BASE_URL,
  PROD_PLAYGROUND_HOSTNAME,
  PROD_STAGE,
} from "./alchemy/schematics-domains.ts";

const playgroundApiBaseUrlOverride =
  process.env["VITE_SCHEMATICS_API_BASE_URL"] ?? process.env["SCHEMATICS_API_BASE_URL"] ?? "";
const pullRequestNumber = Number(process.env["PULL_REQUEST"] ?? "");
const shouldCommentOnPullRequest = Number.isInteger(pullRequestNumber) && pullRequestNumber > 0;
const commitLabel = process.env["GITHUB_SHA"]?.slice(0, 7) || "unknown";
const [githubOwner = "", githubRepository = ""] = (
  process.env["GITHUB_REPOSITORY"] ?? "bjacobso/schema-ide"
).split("/", 2);
// The Comment provider resolves credentials from the stack context when it
// runs, so they must be merged into the providers rather than only provided to
// the provider layer. They are read lazily, so non-PR deploys need no token.
const githubCommentProviders = Layer.effect(
  GitHub.Providers,
  Provider.collection([GitHub.Comment]),
).pipe(Layer.provide(GitHub.CommentProvider()), Layer.provideMerge(GitHub.fromEnv()));
const providers = Layer.mergeAll(Cloudflare.providers(), githubCommentProviders);

export default Alchemy.Stack(
  "schematics",
  {
    providers,
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const stage = yield* Stage;
    const isProd = stage === PROD_STAGE;

    const api = yield* ApiWorker;
    // In prod the API answers on its custom hostname (api.schematics.run); other
    // stages use the per-stage workers.dev URL. An explicit env override always
    // wins.
    const playgroundApiBaseUrl = playgroundApiBaseUrlOverride
      ? playgroundApiBaseUrlOverride
      : isProd
        ? PROD_API_BASE_URL
        : api.url.pipe(Output.map((url) => url ?? ""));

    const playground = yield* Cloudflare.Website.StaticSite("Playground", {
      cwd: "./apps/playground",
      command: "pnpm build",
      outdir: "dist",
      env: {
        VITE_SCHEMATICS_API_BASE_URL: playgroundApiBaseUrl,
      },
      // The schematics.run zone only exists in the production account, so bind
      // the apex hostname only when deploying the prod stage.
      ...(isProd ? { domain: PROD_PLAYGROUND_HOSTNAME } : {}),
      assets: {
        htmlHandling: "auto-trailing-slash",
        notFoundHandling: "single-page-application",
      },
      memo: playgroundMemo,
    });

    if (shouldCommentOnPullRequest) {
      const deployedAt = new Date().toISOString();
      yield* GitHub.Comment("preview-comment", {
        owner: githubOwner,
        repository: githubRepository,
        issueNumber: pullRequestNumber,
        body: Output.all(playground.url, api.url).pipe(
          Output.map(([playgroundUrl, apiUrl]) =>
            [
              "## Cloudflare Preview Deployed",
              "",
              `**Playground:** ${playgroundUrl}`,
              `**API:** ${apiUrl}`,
              "",
              `Built from commit \`${commitLabel}\``,
              "",
              "---",
              `<time datetime="${deployedAt}">${deployedAt}</time>`,
              "",
              "<sub>This comment updates automatically with each push.</sub>",
            ].join("\n"),
          ),
        ),
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
      playgroundApiBaseUrl: playgroundApiBaseUrlOverride
        ? playgroundApiBaseUrlOverride
        : isProd
          ? PROD_API_BASE_URL
          : api.url.pipe(Output.map((url) => url ?? "(relative)")),
    };
  }),
);
