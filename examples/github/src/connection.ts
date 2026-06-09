import type { DeployConnectionOptions } from "@schematics/protocol";
import { defineTokenConnection } from "@schematics/provider";
import { Schema } from "effect";

export const GitHubEnvironmentIdSchema = Schema.Literals([
  "localhost",
  "staging",
  "production",
]);
export type GitHubEnvironmentId = typeof GitHubEnvironmentIdSchema.Type;

export const GitHubAuthMethodIdSchema = Schema.Literals(["token"]);
export type GitHubAuthMethodId = typeof GitHubAuthMethodIdSchema.Type;

export const GITHUB_CONNECTION_OPTIONS: DeployConnectionOptions = defineTokenConnection({
  consumer: "github",
  defaultEnvironment: "production",
  environments: [
    {
      id: "localhost",
      label: "Localhost",
      description: "A local GitHub-compatible API or mock endpoint.",
      baseUrl: "http://localhost:3000",
    },
    {
      id: "staging",
      label: "Staging",
      description: "Shared staging GitHub organization. Safe for trial pulls and applies.",
      baseUrl: "https://staging.github.example",
    },
    {
      id: "production",
      label: "Production",
      description: "The live GitHub organization. Review every plan before applying.",
      baseUrl: "https://api.github.com",
    },
  ],
  authDescription:
    "A GitHub token. Stored server-side as a secret-ref and never returned to the browser or written to files.",
  tokenLabel: "GitHub token",
  tokenDescription: "A personal access token or GitHub App installation token.",
  tokenPlaceholder: "github_pat_...",
});
