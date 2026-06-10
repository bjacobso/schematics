import { describe, expect, it } from "@effect/vitest";
import { Relation } from "@schematics/algebra";
import { createMemoryArtifactStore } from "@schematics/artifacts";
import type { DeployConnectionOptions } from "@schematics/protocol";
import { defineArtifactIngestor, defineArtifactWorkflow } from "@schematics/ingest";
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

const emptyWorkflow = defineArtifactWorkflow({
  id: "acme.empty",
  input: Schema.Struct({ id: Schema.String }),
  output: Schema.Struct({ id: Schema.String }),
  steps: {},
  outputFromSteps: () => ({ id: "ok" }),
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

  it("exposes provider-declared ingestors on the provider and flavor", () => {
    const ingestor = defineArtifactIngestor({
      id: "acme.repo.fromText",
      label: "Add repo from text",
      targetRoutes: ["Repos"],
      creates: ["repos/*.yaml"],
      inputs: Schema.Struct({ id: Schema.String }),
      workflow: emptyWorkflow,
    });
    const withIngestor = defineProvider({
      id: "acme-ingest",
      resources: [Repo, Team],
      connection,
      ingestors: [ingestor],
    });

    expect(withIngestor.ingestors.map((entry) => entry.id)).toEqual(["acme.repo.fromText"]);
    expect(withIngestor.flavor.ingestors).toEqual(withIngestor.ingestors);
  });

  it("rejects ingestors that target unknown routes or uncovered output globs", () => {
    const unknownRoute = defineArtifactIngestor({
      id: "bad.route",
      label: "Bad route",
      targetRoutes: ["Missing"],
      creates: ["repos/*.yaml"],
      inputs: Schema.Struct({ id: Schema.String }),
      workflow: emptyWorkflow,
    });
    expect(() =>
      defineProvider({
        id: "bad-route",
        resources: [Repo, Team],
        connection,
        ingestors: [unknownRoute],
      }),
    ).toThrow(/unknown route Missing/);

    const uncovered = defineArtifactIngestor({
      id: "bad.output",
      label: "Bad output",
      creates: ["reports/*.txt"],
      inputs: Schema.Struct({ id: Schema.String }),
      workflow: emptyWorkflow,
    });
    expect(() =>
      defineProvider({
        id: "bad-output",
        resources: [Repo, Team],
        connection,
        ingestors: [uncovered],
      }),
    ).toThrow(/not covered/);
  });

  it("keeps deploy plan and apply results deterministic when ingestors are declared", async () => {
    const ingestor = defineArtifactIngestor({
      id: "acme.repo.fromText",
      label: "Add repo from text",
      targetRoutes: ["Repos"],
      creates: ["repos/*.yaml"],
      inputs: Schema.Struct({ id: Schema.String }),
      workflow: emptyWorkflow,
    });
    const withIngestor = defineProvider({
      id: "acme-ingest-determinism",
      resources: [Repo, Team],
      connection,
      mockSeed: {
        repos: [{ id: "api", name: "API" }],
        teams: [],
      },
      ingestors: [ingestor],
    });
    const withoutIngestor = defineProvider({
      id: "acme-no-ingest-determinism",
      resources: [Repo, Team],
      connection,
      mockSeed: {
        repos: [{ id: "api", name: "API" }],
        teams: [],
      },
    });
    const storeWithout = createMemoryArtifactStore({
      files: [{ path: "repos/api.yaml", content: "id: api\nname: API v2\n" }],
    });
    const storeWith = createMemoryArtifactStore({
      files: [{ path: "repos/api.yaml", content: "id: api\nname: API v2\n" }],
    });
    const without = withoutIngestor.makeDeployService({ store: storeWithout });
    const withDeclaredIngestor = withIngestor.makeDeployService({ store: storeWith });
    const connectRequest = {
      environment: "production",
      authMethod: "api_key",
      credentials: { token: "secret" },
    } as const;

    await Effect.runPromise(without.connect(connectRequest));
    await Effect.runPromise(withDeclaredIngestor.connect(connectRequest));
    const planWithout = await Effect.runPromise(without.plan());
    const planWith = await Effect.runPromise(withDeclaredIngestor.plan());
    expect(planWith).toEqual(planWithout);

    const applyWithout = await Effect.runPromise(without.apply({ plan: planWithout }));
    const applyWith = await Effect.runPromise(withDeclaredIngestor.apply({ plan: planWith }));
    expect(applyWith).toEqual(applyWithout);
  });
});

describe("defineStack", () => {
  it("mounts a single provider ided as the stack", () => {
    const stack = defineStack({ id: "acme-stack", providers: [provider] });
    expect(stack.flavor.id).toBe("acme-stack");
    expect(stack.flavor.ingestors).toBe(provider.ingestors);
    expect(stack.deploy).toBe(provider.deploy);
  });

  it("rejects multi-provider blending in v1", () => {
    expect(() => defineStack({ id: "blend", providers: [provider, provider] })).toThrow(
      /multi-provider/,
    );
  });
});
