// GitHub org example. The schema exports remain stable, while the provider DSL
// now derives the artifact project, diagnostics, mock transport, deploy service,
// and flavor from `githubResources`.

export * from "./schema";
export { githubResources } from "./resources";
export { GitHubArtifactProject, GitHubProjectBaseSchema, GitHubProjectSchema } from "./project";
export { validateGitHubWorkspaceValue } from "./diagnostics";
export {
  GITHUB_CONNECTION_OPTIONS,
  GitHubAuthMethodIdSchema,
  GitHubEnvironmentIdSchema,
  type GitHubAuthMethodId,
  type GitHubEnvironmentId,
} from "./connection";
export { acmeGitHubSeed, githubSeeds, type GitHubSeed, type GitHubSeedName } from "./seed";
export {
  GitHubConfigDeploy,
  GitHubFlavor,
  githubProvider,
  makeGitHubDeployService,
  makeMockGitHubTransport,
} from "./provider";

// NOTE: `GitHubConfigProject` and `githubCli` intentionally are not re-exported
// here because they pull in Node-oriented CLI dependencies. Import them from the
// `workspace-config` and `cli` subpaths.
