import { describe, expect, it } from "vitest";
import { validateGitHubWorkspaceValue, type GitHubWorkspaceValue } from "../src/index";

const baseWorkspace: GitHubWorkspaceValue = {
  users: [
    { id: "alice", login: "alice-ng" },
    { id: "bob", login: "bob-reyes" },
  ],
  teams: [
    { id: "engineering", name: "Engineering", members: ["alice"] },
    {
      id: "platform",
      name: "Platform",
      parentTeamId: "engineering",
      members: ["alice", "bob"],
      repos: ["web", "infra"],
    },
  ],
  repos: [
    {
      id: "web",
      name: "web",
      visibility: "private",
      environments: [{ name: "production", requiredReviewers: 2 }, { name: "staging" }],
    },
    { id: "infra", name: "infra", visibility: "internal" },
  ],
  branchProtections: [{ id: "web-main", repo: "web", pattern: "main", requiredReviews: 2 }],
};

describe("github diagnostics", () => {
  it("a valid org has no diagnostics", () => {
    expect(validateGitHubWorkspaceValue(baseWorkspace)).toEqual([]);
  });

  it("flags a team granting access to a missing repo (pathRefs)", () => {
    const workspace: GitHubWorkspaceValue = {
      ...baseWorkspace,
      teams: [{ id: "platform", name: "Platform", members: ["alice"], repos: ["ghost-repo"] }],
    };
    const diagnostics = validateGitHubWorkspaceValue(workspace);
    expect(diagnostics.some((d) => d.message === "Unknown repo: ghost-repo")).toBe(true);
  });

  it("flags a branch-protection rule pointing at a missing repo (pathRef)", () => {
    const workspace: GitHubWorkspaceValue = {
      ...baseWorkspace,
      branchProtections: [{ id: "x", repo: "nope", pattern: "main" }],
    };
    const diagnostics = validateGitHubWorkspaceValue(workspace);
    expect(diagnostics.some((d) => d.message === "Unknown repo: nope")).toBe(true);
  });

  it("flags a self-referential team parent that does not exist", () => {
    const workspace: GitHubWorkspaceValue = {
      ...baseWorkspace,
      teams: [{ id: "platform", name: "Platform", parentTeamId: "ghost-team", members: [] }],
    };
    const diagnostics = validateGitHubWorkspaceValue(workspace);
    expect(diagnostics.some((d) => d.message === "Unknown team: ghost-team")).toBe(true);
  });
});
