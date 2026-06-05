import { describe, expect, it } from "vitest";
import { validateOktaWorkspaceValue, type OktaWorkspaceValue } from "../src/index";

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
