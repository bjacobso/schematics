import { createMemoryArtifactStore } from "@schematics/artifacts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  pagerDutyProvider,
  validatePagerDutyWorkspaceValue,
  type PagerDutyWorkspaceValue,
} from "../src/index";

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

describe("pagerduty provider DSL", () => {
  it("connects to the derived mock, pulls files, and re-plans clean", async () => {
    const store = createMemoryArtifactStore();
    const service = pagerDutyProvider.makeDeployService({ store, projectId: "pagerduty-yaml" });

    await Effect.runPromise(
      service.connect({
        environment: "production",
        authMethod: "token",
        credentials: { token: "secret" },
      } as any),
    );

    const pulled = await Effect.runPromise(service.pull());
    const paths = pulled.pulled.map((file) => file.path).sort();
    expect(paths).toContain("teams/platform.yaml");
    expect(paths).toContain("users/alice.yaml");
    expect(paths).toContain("schedules/platform-weekday.yaml");
    expect(paths).toContain("escalation-policies/platform-ep.yaml");
    expect(paths).toContain("services/api.yaml");

    const plan = await Effect.runPromise(service.plan());
    expect(plan.summary).toMatchObject({ create: 0, update: 0, delete: 0 });
  });
});
