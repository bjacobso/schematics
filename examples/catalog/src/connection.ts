import type { DeployConnectionOptions } from "@schematics/protocol";
import { Schema } from "effect";

/**
 * Connection choices the catalog example exposes in the Connect step. Defined
 * here and piped to the UI via `SchematicsDeployService.getConnectionOptions`,
 * so the React Connect form renders generically — no catalog specifics are
 * hard-coded in `@schematics/ide`.
 */
export const CatalogEnvironmentIdSchema = Schema.Literals(["localhost", "staging", "production"]);
export type CatalogEnvironmentId = typeof CatalogEnvironmentIdSchema.Type;

export const CatalogAuthMethodIdSchema = Schema.Literals(["api_key"]);
export type CatalogAuthMethodId = typeof CatalogAuthMethodIdSchema.Type;

export const CATALOG_CONNECTION_OPTIONS: DeployConnectionOptions = {
  consumer: "catalog",
  defaultEnvironment: "production",
  defaultAuthMethod: "api_key",
  environments: [
    {
      id: "localhost",
      label: "Localhost",
      description: "A locally running catalog API (http://localhost:3000).",
      baseUrl: "http://localhost:3000",
    },
    {
      id: "staging",
      label: "Staging",
      description: "Shared staging catalog. Safe for trial pulls and applies.",
      baseUrl: "https://staging.library.example",
    },
    {
      id: "production",
      label: "Production",
      description: "The live catalog. Review every plan before applying.",
      baseUrl: "https://api.library.example",
    },
  ],
  authMethods: [
    {
      id: "api_key",
      label: "API key",
      description:
        "A Bearer api token. Stored server-side as a secret-ref and never returned to the browser or written to files.",
      fields: [
        {
          key: "token",
          label: "API token",
          description: "Your catalog API token.",
          type: "password",
          required: true,
          placeholder: "lib_live_…",
        },
      ],
    },
  ],
};
