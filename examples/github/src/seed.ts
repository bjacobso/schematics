import type { BranchProtectionConfig, RepoConfig, TeamConfig, UserConfig } from "./schema";

export interface GitHubSeed extends Readonly<Record<string, readonly unknown[]>> {
  readonly users: readonly UserConfig[];
  readonly teams: readonly TeamConfig[];
  readonly repos: readonly RepoConfig[];
  readonly branchProtections: readonly BranchProtectionConfig[];
}

/** The ACME fixture account pulled by the derived mock transport. */
export const acmeGitHubSeed: GitHubSeed = {
  users: [
    { id: "alice", login: "alice-ng", name: "Alice Ng" },
    { id: "bob", login: "bob-reyes", name: "Bob Reyes" },
    { id: "carol", login: "carol-singh", name: "Carol Singh" },
    { id: "dana", login: "dana-kim", name: "Dana Kim" },
    { id: "eli", login: "eli-morgan", name: "Eli Morgan" },
    { id: "fatima", login: "fatima-ali", name: "Fatima Ali" },
  ],
  teams: [
    { id: "engineering", name: "Engineering", members: ["alice", "dana"] },
    {
      id: "platform",
      name: "Platform",
      parentTeamId: "engineering",
      members: ["alice", "bob", "eli"],
      repos: ["infra", "web"],
    },
    {
      id: "backend",
      name: "Backend",
      parentTeamId: "engineering",
      members: ["carol", "fatima"],
      repos: ["api"],
    },
  ],
  repos: [
    {
      id: "web",
      name: "web",
      visibility: "private",
      defaultBranch: "main",
      environments: [{ name: "production", requiredReviewers: 2 }, { name: "staging" }],
    },
    {
      id: "api",
      name: "api",
      visibility: "private",
      defaultBranch: "main",
      environments: [{ name: "production", requiredReviewers: 1 }],
    },
    { id: "infra", name: "infra", visibility: "internal", defaultBranch: "main" },
    {
      id: "docs",
      name: "docs",
      visibility: "public",
      defaultBranch: "main",
      environments: [{ name: "preview" }],
    },
  ],
  branchProtections: [
    { id: "web-main", repo: "web", pattern: "main", requiredReviews: 2 },
    { id: "api-main", repo: "api", pattern: "main", requiredReviews: 1 },
  ],
};

export const githubSeeds = {
  acme: acmeGitHubSeed,
} as const satisfies Record<string, GitHubSeed>;

export type GitHubSeedName = keyof typeof githubSeeds;
