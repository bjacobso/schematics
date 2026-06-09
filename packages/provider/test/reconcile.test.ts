import { describe, expect, it } from "@effect/vitest";
import { Relation } from "@schematics/algebra";
import { createMemoryArtifactStore } from "@schematics/artifacts";
import { Effect, Schema } from "effect";
import { defineResource, makeProviderConfigDeploy, type ResourceCrud } from "../src";

interface RepoRecord {
  readonly id: string;
  readonly name: string;
}

// A tiny Map-backed transport (config == wire) standing in for a real/mock API.
function makeTestApi(seed: readonly RepoRecord[]): { repos: ResourceCrud<RepoRecord> } {
  const store = new Map(seed.map((record) => [record.id, record] as const));
  return {
    repos: {
      list: Effect.sync(() => [...store.values()]),
      get: (id) => Effect.sync(() => store.get(id) ?? null),
      create: (record) =>
        Effect.sync(() => {
          store.set(record.id, record);
          return record;
        }),
      update: (id, record) =>
        Effect.sync(() => {
          store.set(id, record);
          return record;
        }),
      delete: (id) =>
        Effect.sync(() => {
          store.delete(id);
        }),
    },
  };
}

const Repo = defineResource<RepoRecord, RepoRecord, { repos: ResourceCrud<RepoRecord> }>({
  kind: "repo",
  schemaId: "Repos",
  schema: Schema.Struct({ id: Relation.id("repo", { display: "name" }), name: Schema.String }),
  remote: (api) => api.repos,
});

describe("makeProviderConfigDeploy", () => {
  it("pulls remote records into the working tree, then re-plans clean", async () => {
    const store = createMemoryArtifactStore();
    const api = makeTestApi([
      { id: "api", name: "API" },
      { id: "web", name: "Web" },
    ]);
    const deploy = makeProviderConfigDeploy([Repo], { store, api });

    const pulled = await Effect.runPromise(deploy.pull);
    expect(pulled.pulled.map((file) => file.path).sort()).toEqual([
      "repos/api.yaml",
      "repos/web.yaml",
    ]);

    // After pulling, desired (tree) == live (api), so no real changes (only noops).
    const plan = await Effect.runPromise(deploy.plan);
    expect(plan.changes.filter((change) => change.action !== "noop")).toEqual([]);
  });

  it("applies deletes against the remote (destroy)", async () => {
    const store = createMemoryArtifactStore();
    const api = makeTestApi([
      { id: "api", name: "API" },
      { id: "web", name: "Web" },
    ]);
    const deploy = makeProviderConfigDeploy([Repo], { store, api });

    await Effect.runPromise(deploy.pull);
    const applied = await Effect.runPromise(deploy.destroy);
    expect(applied.applied.length).toBe(2);

    // The remote is now empty — the reconciler's remove path ran for each repo.
    const live = await Effect.runPromise(api.repos.list);
    expect(live).toEqual([]);
  });
});
