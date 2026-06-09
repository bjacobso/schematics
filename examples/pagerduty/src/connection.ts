import type { DeployConnectionOptions } from "@schematics/protocol";
import { defineTokenConnection } from "@schematics/provider";
import { Schema } from "effect";

export const PagerDutyEnvironmentIdSchema = Schema.Literals([
  "localhost",
  "staging",
  "production",
]);
export type PagerDutyEnvironmentId = typeof PagerDutyEnvironmentIdSchema.Type;

export const PagerDutyAuthMethodIdSchema = Schema.Literals(["token"]);
export type PagerDutyAuthMethodId = typeof PagerDutyAuthMethodIdSchema.Type;

export const PAGERDUTY_CONNECTION_OPTIONS: DeployConnectionOptions = defineTokenConnection({
  consumer: "pagerduty",
  defaultEnvironment: "production",
  environments: [
    {
      id: "localhost",
      label: "Localhost",
      description: "A local PagerDuty-compatible API or mock endpoint.",
      baseUrl: "http://localhost:3000",
    },
    {
      id: "staging",
      label: "Staging",
      description: "Shared staging on-call account.",
      baseUrl: "https://staging.pagerduty.example",
    },
    {
      id: "production",
      label: "Production",
      description: "The live PagerDuty account.",
      baseUrl: "https://api.pagerduty.com",
    },
  ],
  authDescription: "A PagerDuty API token stored as a secret-ref.",
  tokenLabel: "PagerDuty token",
});
