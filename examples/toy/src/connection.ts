import type { DeployConnectionOptions } from "@schematics/protocol";
import { defineTokenConnection } from "@schematics/provider";
import { Schema } from "effect";

export const ToyEnvironmentIdSchema = Schema.Literals(["localhost", "staging", "production"]);
export type ToyEnvironmentId = typeof ToyEnvironmentIdSchema.Type;

export const ToyAuthMethodIdSchema = Schema.Literals(["token"]);
export type ToyAuthMethodId = typeof ToyAuthMethodIdSchema.Type;

export const TOY_CONNECTION_OPTIONS: DeployConnectionOptions = defineTokenConnection({
  consumer: "toy",
  defaultEnvironment: "localhost",
  environments: [
    {
      id: "localhost",
      label: "Localhost",
      description: "A local toy API or mock endpoint.",
      baseUrl: "http://localhost:3000",
    },
    {
      id: "staging",
      label: "Staging",
      description: "Shared staging toy account.",
      baseUrl: "https://staging.toy.example",
    },
    {
      id: "production",
      label: "Production",
      description: "The live toy account.",
      baseUrl: "https://toy.example",
    },
  ],
  authDescription: "A demo token stored as a secret-ref.",
});
