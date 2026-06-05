import { describe, expect, it } from "vitest";
import { validatePagerDutyWorkspaceValue, type PagerDutyWorkspaceValue } from "../src/index";

const baseWorkspace: PagerDutyWorkspaceValue = {
  teams: [{ id: "platform", name: "Platform" }],
  users: [
    { id: "alice", name: "Alice", email: "alice@acme.example" },
    { id: "bob", name: "Bob", email: "bob@acme.example" },
  ],
  schedules: [{ id: "weekday", name: "Weekday", team: "platform", rotation: ["alice", "bob"] }],
  escalationPolicies: [
    { id: "platform-ep", name: "Platform", team: "platform", schedules: ["weekday"] },
  ],
  services: [{ id: "api", name: "API", team: "platform", escalationPolicy: "platform-ep" }],
};

describe("pagerduty diagnostics", () => {
  it("a valid on-call config has no diagnostics", () => {
    expect(validatePagerDutyWorkspaceValue(baseWorkspace)).toEqual([]);
  });

  it("flags a service pointing at a missing escalation policy", () => {
    const workspace: PagerDutyWorkspaceValue = {
      ...baseWorkspace,
      services: [{ id: "api", name: "API", escalationPolicy: "ghost-ep" }],
    };
    const diagnostics = validatePagerDutyWorkspaceValue(workspace);
    expect(diagnostics.some((d) => d.message === "Unknown escalationPolicy: ghost-ep")).toBe(true);
  });

  it("flags a schedule rotation with an unknown user", () => {
    const workspace: PagerDutyWorkspaceValue = {
      ...baseWorkspace,
      schedules: [{ id: "weekday", name: "Weekday", rotation: ["alice", "nobody"] }],
    };
    const diagnostics = validatePagerDutyWorkspaceValue(workspace);
    expect(diagnostics.some((d) => d.message === "Unknown user: nobody")).toBe(true);
  });
});
