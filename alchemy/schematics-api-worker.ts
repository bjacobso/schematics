import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Effect, Option, Redacted } from "effect";
import {
  makeSchematicsArtifactsNamespace,
  makeSchematicsWorkspaceNamespace,
  schematicsArtifactsBindingName,
} from "../packages/cloudflare/src/alchemy.ts";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1";
const DEFAULT_REFERER = "https://schematics.pages.dev";
const DEFAULT_TITLE = "Schematics Playground";

const optionalRedacted = (name: string) => Config.option(Config.redacted(name));

const SchematicsWorkerConfig = Config.all({
  openRouterApiKey: optionalRedacted("OPENROUTER_API_KEY"),
  apiUrl: Config.withDefault(Config.string("OPENROUTER_API_URL"), OPENROUTER_API_URL),
  referer: Config.withDefault(Config.string("SCHEMATICS_REFERER"), DEFAULT_REFERER),
  title: Config.withDefault(Config.string("SCHEMATICS_TITLE"), DEFAULT_TITLE),
  // Optional override for the Cloudflare Artifacts namespace name. Left unset,
  // Alchemy derives a unique per-stage name (like `…-pr-20`, `…-prod`), so each
  // stage gets its own isolated set of workspace Git repos — matching how the
  // Api/Playground workers are named per stage.
  artifactsNamespace: Config.option(Config.string("SCHEMATICS_ARTIFACTS_NAMESPACE")),
});

export default Cloudflare.Worker(
  "Api",
  SchematicsWorkerConfig.pipe(
    Effect.map((config) => {
      const env = {
        OPENROUTER_API_URL: config.apiUrl,
        SCHEMATICS_REFERER: config.referer,
        SCHEMATICS_TITLE: config.title,
        ...Option.match(config.openRouterApiKey, {
          onNone: () => ({}),
          onSome: (apiKey) => ({ OPENROUTER_API_KEY: Redacted.value(apiKey) }),
        }),
      };

      // Always bound; the namespace is per-stage unless explicitly overridden.
      const artifactsNamespace = makeSchematicsArtifactsNamespace(
        Option.match(config.artifactsNamespace, {
          onNone: () => ({}),
          onSome: (namespace) => ({ namespace }),
        }),
      );

      return {
        main: new URL("./schematics-api-worker-runtime.ts", import.meta.url).pathname,
        env,
        bindings: {
          SCHEMATICS_WORKSPACES: makeSchematicsWorkspaceNamespace(),
          [schematicsArtifactsBindingName]: artifactsNamespace,
        },
      };
    }),
    Effect.orDie,
  ),
);
