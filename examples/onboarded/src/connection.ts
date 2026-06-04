import type { DeployConnectionOptions } from "@schematics/protocol";
import { Schema } from "effect";

/**
 * Connection choices Onboarded exposes in the Connect step. Defined here (the
 * consumer package) and piped to the UI via `SchematicsDeployService.getConnectionOptions`,
 * so the React Connect form renders generically from this data — no Onboarded
 * specifics are hard-coded in `@schematics/ide`.
 */

/** Target environment ids, registered as a schema for validation/reuse. */
export const OnboardedEnvironmentIdSchema = Schema.Literals(["localhost", "staging", "production"]);

export type OnboardedEnvironmentId = typeof OnboardedEnvironmentIdSchema.Type;

/** Supported auth strategies, registered as a schema for validation/reuse. */
export const OnboardedAuthMethodIdSchema = Schema.Literals(["api_key", "session_cookie"]);

export type OnboardedAuthMethodId = typeof OnboardedAuthMethodIdSchema.Type;

export const ONBOARDED_CONNECTION_OPTIONS: DeployConnectionOptions = {
  consumer: "onboarded",
  defaultEnvironment: "production",
  defaultAuthMethod: "api_key",
  environments: [
    {
      id: "localhost",
      label: "Localhost",
      description:
        "A locally running Onboarded API (http://localhost:3000). Use when developing against a dev server on your machine.",
      baseUrl: "http://localhost:3000",
    },
    {
      id: "staging",
      label: "Staging",
      description:
        "The shared staging environment. Safe for trial pulls and applies — data is isolated from production.",
      baseUrl: "https://staging-app.onboarded.com",
    },
    {
      id: "production",
      label: "Production",
      description:
        "The live production account. Plans and applies affect real data — review every plan before applying.",
      baseUrl: "https://api.onboarded.com",
    },
  ],
  authMethods: [
    {
      id: "api_key",
      label: "API key",
      description:
        "A Bearer api_token. Recommended for automation and CI. Stored server-side as a secret-ref and never returned to the browser or written to files.",
      fields: [
        {
          key: "token",
          label: "API token",
          description: "Your Onboarded API token (api_token).",
          type: "password",
          required: true,
          placeholder: "ob_live_…",
        },
      ],
    },
    {
      id: "session_cookie",
      label: "Session cookie",
      description:
        "Reuse a logged-in dashboard session cookie. Convenient for quick local testing, but expires with the browser session.",
      fields: [
        {
          key: "cookie",
          label: "Session cookie",
          description: "The value of your Onboarded dashboard session cookie.",
          type: "password",
          required: true,
        },
      ],
    },
  ],
};
