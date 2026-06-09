import { createMemoryArtifactStore } from "@schematics/artifacts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { oktaProvider, validateOktaWorkspaceValue, type OktaWorkspaceValue } from "../src/index";

const baseWorkspace: OktaWorkspaceValue = {
  authServers: [
    {
      id: "default",
      name: "Default",
      audience: "api://default",
      scopes: [{ value: "read:profile" }, { value: "write:profile" }],
    },
  ],
  apps: [
    { id: "internal-api", label: "Internal API", signOnMode: "oidc", authServerId: "default" },
    { id: "salesforce", label: "Salesforce", signOnMode: "saml" },
  ],
  groups: [{ id: "engineering", name: "Engineering", apps: ["internal-api"] }],
  users: [{ id: "alice", email: "alice@acme.example", groups: ["engineering"] }],
  policies: [{ id: "mfa", name: "Require MFA", type: "mfa-enroll", groups: ["engineering"] }],
};

describe("okta diagnostics", () => {
  it("a valid identity config has no diagnostics", () => {
    expect(validateOktaWorkspaceValue(baseWorkspace)).toEqual([]);
  });

  it("flags a group assigning an app that does not exist", () => {
    const workspace: OktaWorkspaceValue = {
      ...baseWorkspace,
      groups: [{ id: "engineering", name: "Engineering", apps: ["ghost-app"] }],
    };
    const diagnostics = validateOktaWorkspaceValue(workspace);
    expect(diagnostics.some((d) => d.message === "Unknown app: ghost-app")).toBe(true);
  });

  it("flags a user in a missing group", () => {
    const workspace: OktaWorkspaceValue = {
      ...baseWorkspace,
      users: [{ id: "alice", email: "alice@acme.example", groups: ["nope"] }],
    };
    const diagnostics = validateOktaWorkspaceValue(workspace);
    expect(diagnostics.some((d) => d.message === "Unknown group: nope")).toBe(true);
  });
});

describe("okta provider DSL", () => {
  it("connects to the derived mock, pulls files, and re-plans clean", async () => {
    const store = createMemoryArtifactStore();
    const service = oktaProvider.makeDeployService({ store, projectId: "okta-yaml" });

    await Effect.runPromise(
      service.connect({
        environment: "production",
        authMethod: "token",
        credentials: { token: "secret" },
      } as any),
    );

    const pulled = await Effect.runPromise(service.pull());
    const paths = pulled.pulled.map((file) => file.path).sort();
    expect(paths).toContain("auth-servers/default.yaml");
    expect(paths).toContain("apps/internal-api.yaml");
    expect(paths).toContain("groups/engineering.yaml");
    expect(paths).toContain("users/alice.yaml");
    expect(paths).toContain("policies/require-mfa.yaml");

    const plan = await Effect.runPromise(service.plan());
    expect(plan.summary).toMatchObject({ create: 0, update: 0, delete: 0 });
  });
});
