import { describe, expect, it } from "@effect/vitest";
import { Relation } from "@schematics/algebra";
import { createMemoryArtifactStore } from "@schematics/artifacts";
import type { DeployConnectionOptions } from "@schematics/protocol";
import { Effect, Schema } from "effect";
import { defineProvider, defineResource, defineStack } from "../src";

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

const connection: DeployConnectionOptions = {
  consumer: "acme",
  defaultEnvironment: "production",
  defaultAuthMethod: "api_key",
  environments: [{ id: "production", label: "Production", baseUrl: "https://api.acme.test" }],
  authMethods: [
    {
      id: "api_key",
      label: "API key",
      fields: [{ key: "token", label: "API token", type: "password", required: true }],
    },
  ],
};

const provider = defineProvider({
  id: "acme",
  title: "Acme Config",
  resources: [Repo, Team],
  connection,
  mockSeed: {
    repos: [{ id: "api", name: "API" }],
    teams: [{ id: "backend", name: "Backend", repos: ["api"] }],
  },
});

describe("defineProvider", () => {
  it("exposes a flavor that mounts in the harness", () => {
    expect(provider.flavor.id).toBe("acme");
    expect(provider.flavor.project).toBe(provider.project);
    expect(provider.flavor.defaultFormat).toBe("yaml");
    expect(provider.flavor.deploy?.createService).toBeTypeOf("function");
    expect(provider.project.routes.map((route) => route.id)).toEqual(["Repos", "Teams"]);
  });

  it("derives a deploy service whose default mock connects and pulls", async () => {
    const store = createMemoryArtifactStore();
    const service = provider.makeDeployService({ store });

    await Effect.runPromise(
      service.connect({
        environment: "production",
        authMethod: "api_key",
        credentials: { token: "secret" },
      } as any),
    );
    const pulled = await Effect.runPromise(service.pull());
    expect(pulled.pulled.map((file) => file.path).sort()).toEqual([
      "repos/api.yaml",
      "teams/backend.yaml",
    ]);
  });

  it("validates the derived project schema (unresolved refs)", () => {
    const diagnostics = provider.projectDiagnostics(
      {
        repos: [{ id: "api", name: "API" }],
        teams: [{ id: "backend", name: "Backend", repos: ["ghost"] }],
      },
      { files: [] },
    );
    expect(diagnostics.map((d) => d.message)).toContain("Unknown repo: ghost");
  });
});

describe("defineStack", () => {
  it("mounts a single provider ided as the stack", () => {
    const stack = defineStack({ id: "acme-stack", providers: [provider] });
    expect(stack.flavor.id).toBe("acme-stack");
    expect(stack.deploy).toBe(provider.deploy);
  });

  it("rejects multi-provider blending in v1", () => {
    expect(() => defineStack({ id: "blend", providers: [provider, provider] })).toThrow(
      /multi-provider/,
    );
  });
});
