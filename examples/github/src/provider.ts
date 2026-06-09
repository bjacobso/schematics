import { defineProvider } from "@schematics/provider";
import { GITHUB_CONNECTION_OPTIONS } from "./connection";
import { githubResources } from "./resources";
import { acmeGitHubSeed } from "./seed";

export const githubProvider = defineProvider({
  id: "github",
  projectId: "github-yaml",
  title: "GitHub Org",
  resources: githubResources,
  connection: GITHUB_CONNECTION_OPTIONS,
  mockSeed: acmeGitHubSeed,
  include: ["**/*.yaml", "config.lock.json", ".env", ".env.*"],
  metadata: ["config.lock.json"],
  secret: [".env", ".env.*"],
});

export const GitHubFlavor = githubProvider.flavor;
export const GitHubConfigDeploy = githubProvider.deploy;
export const makeGitHubDeployService = githubProvider.makeDeployService;
export const makeMockGitHubTransport = githubProvider.mock;
