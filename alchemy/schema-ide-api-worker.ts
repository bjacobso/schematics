import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Effect, Option, Redacted } from "effect";
import {
  makeSchemaIdeArtifactsNamespace,
  makeSchemaIdeWorkspaceNamespace,
  schemaIdeArtifactsBindingName,
} from "../packages/cloudflare/src/alchemy.ts";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1";
const DEFAULT_REFERER = "https://schema-ide.pages.dev";
const DEFAULT_TITLE = "Schema IDE Playground";

const optionalRedacted = (name: string) => Config.option(Config.redacted(name));

const SchemaIdeWorkerConfig = Config.all({
  openRouterApiKey: optionalRedacted("OPENROUTER_API_KEY"),
  apiUrl: Config.withDefault(Config.string("OPENROUTER_API_URL"), OPENROUTER_API_URL),
  referer: Config.withDefault(Config.string("SCHEMA_IDE_REFERER"), DEFAULT_REFERER),
  title: Config.withDefault(Config.string("SCHEMA_IDE_TITLE"), DEFAULT_TITLE),
  // Optional override for the Cloudflare Artifacts namespace name. Left unset,
  // Alchemy derives a unique per-stage name (like `…-pr-20`, `…-prod`), so each
  // stage gets its own isolated set of workspace Git repos — matching how the
  // Api/Playground workers are named per stage.
  artifactsNamespace: Config.option(Config.string("SCHEMA_IDE_ARTIFACTS_NAMESPACE")),
});

export default Cloudflare.Worker(
  "Api",
  SchemaIdeWorkerConfig.pipe(
    Effect.map((config) => {
      const env = {
        OPENROUTER_API_URL: config.apiUrl,
        SCHEMA_IDE_REFERER: config.referer,
        SCHEMA_IDE_TITLE: config.title,
        ...Option.match(config.openRouterApiKey, {
          onNone: () => ({}),
          onSome: (apiKey) => ({ OPENROUTER_API_KEY: Redacted.value(apiKey) }),
        }),
      };

      // Always bound; the namespace is per-stage unless explicitly overridden.
      const artifactsNamespace = makeSchemaIdeArtifactsNamespace(
        Option.match(config.artifactsNamespace, {
          onNone: () => ({}),
          onSome: (namespace) => ({ namespace }),
        }),
      );

      return {
        main: new URL("./schema-ide-api-worker-runtime.ts", import.meta.url).pathname,
        env,
        bindings: {
          SCHEMA_IDE_WORKSPACES: makeSchemaIdeWorkspaceNamespace(),
          [schemaIdeArtifactsBindingName]: artifactsNamespace,
        },
      };
    }),
    Effect.orDie,
  ),
);
