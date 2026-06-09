import type { DeployConnectionOptions } from "@schematics/protocol";
import { defineTokenConnection } from "@schematics/provider";
import { Schema } from "effect";

export const OktaEnvironmentIdSchema = Schema.Literals(["localhost", "staging", "production"]);
export type OktaEnvironmentId = typeof OktaEnvironmentIdSchema.Type;

export const OktaAuthMethodIdSchema = Schema.Literals(["token"]);
export type OktaAuthMethodId = typeof OktaAuthMethodIdSchema.Type;

export const OKTA_CONNECTION_OPTIONS: DeployConnectionOptions = defineTokenConnection({
  consumer: "okta",
  defaultEnvironment: "production",
  environments: [
    {
      id: "localhost",
      label: "Localhost",
      description: "A local Okta-compatible API or mock endpoint.",
      baseUrl: "http://localhost:3000",
    },
    {
      id: "staging",
      label: "Staging",
      description: "Shared staging identity org.",
      baseUrl: "https://staging.okta.example",
    },
    {
      id: "production",
      label: "Production",
      description: "The live identity org.",
      baseUrl: "https://okta.example",
    },
  ],
  authDescription: "An Okta API token stored as a secret-ref.",
  tokenLabel: "Okta token",
});
