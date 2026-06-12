import type { DeployConnectionOptions } from "@schematics/protocol";
import { defineTokenConnection } from "@schematics/provider";
import { Schema } from "effect";

export const WorkatoEnvironmentIdSchema = Schema.Literals(["localhost", "test", "production"]);
export type WorkatoEnvironmentId = typeof WorkatoEnvironmentIdSchema.Type;

export const WorkatoAuthMethodIdSchema = Schema.Literals(["token"]);
export type WorkatoAuthMethodId = typeof WorkatoAuthMethodIdSchema.Type;

export const WORKATO_CONNECTION_OPTIONS: DeployConnectionOptions = defineTokenConnection({
  consumer: "workato",
  defaultEnvironment: "production",
  environments: [
    {
      id: "localhost",
      label: "Localhost",
      description: "A local Workato-compatible API or mock endpoint.",
      baseUrl: "http://localhost:3000",
    },
    {
      id: "test",
      label: "Test",
      description: "The TEST lifecycle environment of the workspace.",
      baseUrl: "https://test.workato.example/api",
    },
    {
      id: "production",
      label: "Production",
      description: "The PROD lifecycle environment running live recipes.",
      baseUrl: "https://workato.example/api",
    },
  ],
  authDescription: "A Workato API client token stored as a secret-ref.",
  tokenLabel: "Workato API token",
});
