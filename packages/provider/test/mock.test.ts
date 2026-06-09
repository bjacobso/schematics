import { describe, expect, it } from "@effect/vitest";
import { Relation } from "@schematics/algebra";
import { createMemoryArtifactStore } from "@schematics/artifacts";
import { Effect, Schema } from "effect";
import { defineResource, deriveMockTransport, makeProviderConfigDeploy } from "../src";

const Repo = defineResource({
  kind: "repo",
  schemaId: "Repos",
  schema: Schema.Struct({ id: Relation.id("repo", { display: "name" }), name: Schema.String }),
});
const Team = defineResource({
  kind: "team",
  schemaId: "Teams",
  schema: Schema.Struct({
    id: Relation.id("team", { display: "name" }),
    name: Schema.String,
    repos: Relation.refs("repo"),
  }),
});
const resources = [Repo, Team];

describe("deriveMockTransport", () => {
  it("seeds per remoteKey, lists, and snapshots", async () => {
    const mock = deriveMockTransport(resources, {
      seed: {
        repos: [{ id: "api", name: "API" }],
        teams: [{ id: "backend", name: "Backend", repos: ["api"] }],
      },
    });

    const repos = await Effect.runPromise(mock.api.repos!.list);
    expect(repos.map((r) => r.id)).toEqual(["api"]);

    const snapshot = await Effect.runPromise(mock.snapshot);
    expect(Object.keys(snapshot).sort()).toEqual(["repos", "teams"]);
    expect(mock.calls.some((call) => call.group === "repos" && call.operation === "list")).toBe(
      true,
    );
  });

  it("drives a real pull through the reconciler with no hand-written mock", async () => {
    const store = createMemoryArtifactStore();
    const mock = deriveMockTransport(resources, {
      seed: {
        repos: [{ id: "api", name: "API" }],
        teams: [{ id: "backend", name: "Backend", repos: ["api"] }],
      },
    });
    const deploy = makeProviderConfigDeploy(resources, { store, api: mock.api });

    const pulled = await Effect.runPromise(deploy.pull);
    expect(pulled.pulled.map((file) => file.path).sort()).toEqual([
      "repos/api.yaml",
      "teams/backend.yaml",
    ]);

    // Destroy then confirm the derived mock is empty — create/list/delete all ran.
    await Effect.runPromise(deploy.destroy);
    const after = await Effect.runPromise(mock.snapshot);
    expect(after["repos"]).toEqual([]);
    expect(after["teams"]).toEqual([]);
  });
});
