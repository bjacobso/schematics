import { ArtifactRef, createMemoryArtifactStore } from "@schematics/artifacts";
import { makeProviderConfigDeploy } from "@schematics/provider";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  acmeGitHubSeed,
  githubProvider,
  githubResources,
  makeMockGitHubTransport,
  validateGitHubWorkspaceValue,
  type GitHubWorkspaceValue,
} from "../src/index";

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

describe("github provider DSL", () => {
  it("derives the project, flavor, mock transport, and connection surface", () => {
    expect(githubProvider.flavor.id).toBe("github");
    expect(githubProvider.flavor.project).toBe(githubProvider.project);
    expect(githubProvider.flavor.deploy?.createService).toBeTypeOf("function");
    expect(githubProvider.project.routes.map((route) => route.id)).toEqual([
      "Users",
      "Teams",
      "Repos",
      "BranchProtections",
    ]);
    expect(githubProvider.connection.defaultAuthMethod).toBe("token");

    const mock = makeMockGitHubTransport();
    expect(Object.keys(mock.api).sort()).toEqual(["branchProtections", "repos", "teams", "users"]);
  });

  it("connects the derived deploy service to the default mock and pulls files", async () => {
    const store = createMemoryArtifactStore();
    const service = githubProvider.makeDeployService({ store, projectId: "github-yaml" });

    await Effect.runPromise(
      service.connect({
        environment: "production",
        authMethod: "token",
        credentials: { token: "secret" },
      } as any),
    );

    const pulled = await Effect.runPromise(service.pull());
    const paths = pulled.pulled.map((file) => file.path).sort();
    expect(paths).toContain("users/alice.yaml");
    expect(paths).toContain("teams/platform.yaml");
    expect(paths).toContain("repos/web.yaml");
    expect(paths).toContain("branch-protections/web-main.yaml");

    const plan = await Effect.runPromise(service.plan());
    expect(plan.summary).toMatchObject({ create: 0, update: 0, delete: 0 });
  });

  it("runs pull -> edit a team -> plan -> apply -> re-plan with the derived mock", async () => {
    const store = createMemoryArtifactStore();
    const mock = makeMockGitHubTransport(acmeGitHubSeed);
    const deploy = makeProviderConfigDeploy(githubResources, {
      store,
      api: mock.api,
      projectId: "github-yaml",
    });

    await Effect.runPromise(deploy.pull);
    await Effect.runPromise(
      store.write(
        ArtifactRef.projectFile("teams/platform.yaml", "github-yaml"),
        [
          "id: platform",
          "name: Platform Team",
          "parentTeamId: engineering",
          "members:",
          "  - alice",
          "  - bob",
          "  - eli",
          "repos:",
          "  - infra",
          "  - web",
          "",
        ].join("\n"),
      ),
    );

    const plan = await Effect.runPromise(deploy.plan);
    expect(plan.summary).toMatchObject({ create: 0, update: 1, delete: 0 });
    const update = plan.changes.find((change) => change.action === "update");
    expect(update?.kind).toBe("team");
    expect(update?.key).toBe("platform");
    expect(update?.fields).toEqual([{ path: "name", before: "Platform", after: "Platform Team" }]);

    const applied = await Effect.runPromise(deploy.apply(plan));
    expect(applied.applied).toHaveLength(1);

    const snapshot = await Effect.runPromise(mock.snapshot);
    expect(snapshot["teams"]?.find((team) => team.id === "platform")?.name).toBe("Platform Team");

    const settled = await Effect.runPromise(deploy.plan);
    expect(settled.summary).toMatchObject({ create: 0, update: 0, delete: 0 });
  });
});
