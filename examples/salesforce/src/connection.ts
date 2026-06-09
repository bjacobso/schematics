import type { DeployConnectionOptions } from "@schematics/protocol";
import { defineTokenConnection } from "@schematics/provider";
import { Schema } from "effect";

export const SalesforceEnvironmentIdSchema = Schema.Literals([
  "localhost",
  "staging",
  "production",
]);
export type SalesforceEnvironmentId = typeof SalesforceEnvironmentIdSchema.Type;

export const SalesforceAuthMethodIdSchema = Schema.Literals(["token"]);
export type SalesforceAuthMethodId = typeof SalesforceAuthMethodIdSchema.Type;

export const SALESFORCE_CONNECTION_OPTIONS: DeployConnectionOptions = defineTokenConnection({
  consumer: "salesforce",
  defaultEnvironment: "production",
  environments: [
    {
      id: "localhost",
      label: "Localhost",
      description: "A local Salesforce-compatible API or mock endpoint.",
      baseUrl: "http://localhost:3000",
    },
    {
      id: "staging",
      label: "Sandbox",
      description: "A Salesforce sandbox org.",
      baseUrl: "https://test.salesforce.com",
    },
    {
      id: "production",
      label: "Production",
      description: "The live Salesforce org.",
      baseUrl: "https://login.salesforce.com",
    },
  ],
  authDescription: "A Salesforce access token stored as a secret-ref.",
  tokenLabel: "Salesforce token",
});
