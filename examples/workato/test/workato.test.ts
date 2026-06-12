import { createMemoryArtifactStore } from "@schematics/artifacts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  acmeWorkatoSeed,
  validateWorkatoWorkspaceValue,
  workatoProvider,
  type WorkatoWorkspaceValue,
} from "../src/index";

const baseWorkspace: WorkatoWorkspaceValue = {
  folders: acmeWorkatoSeed.folders,
  connections: acmeWorkatoSeed.connections,
  lookupTables: acmeWorkatoSeed.lookupTables,
  properties: acmeWorkatoSeed.properties[0]!,
  recipes: acmeWorkatoSeed.recipes,
};

describe("workato diagnostics", () => {
  it("a valid automation workspace has no diagnostics", () => {
    expect(validateWorkatoWorkspaceValue(baseWorkspace)).toEqual([]);
  });

  it("flags an action using a connection that does not exist, deep in a rescue block", () => {
    const workspace: WorkatoWorkspaceValue = {
      ...baseWorkspace,
      recipes: [
        {
          id: "broken",
          name: "Broken",
          trigger: { adapter: "salesforce", event: "object_updated" },
          steps: [
            {
              keyword: "foreach",
              source: "=_('trigger.items')",
              steps: [
                {
                  keyword: "handle_errors",
                  monitor: [],
                  rescue: [
                    {
                      keyword: "action",
                      name: "Ghost call",
                      adapter: "http",
                      operation: "post",
                      connectionId: "ghost-connection",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const diagnostics = validateWorkatoWorkspaceValue(workspace);
    expect(diagnostics.some((d) => d.message === "Unknown connection: ghost-connection")).toBe(
      true,
    );
  });

  it("flags a call_recipe step pointing at a missing recipe function", () => {
    const workspace: WorkatoWorkspaceValue = {
      ...baseWorkspace,
      recipes: [
        {
          id: "caller",
          name: "Caller",
          trigger: { adapter: "workato", event: "recipe_function_call" },
          steps: [
            {
              keyword: "if",
              condition: "=_('input.go')",
              then: [{ keyword: "call_recipe", recipeId: "does-not-exist" }],
            },
          ],
        },
      ],
    };
    const diagnostics = validateWorkatoWorkspaceValue(workspace);
    expect(diagnostics.some((d) => d.message === "Unknown recipe: does-not-exist")).toBe(true);
  });

  it("flags a lookup step reading a missing lookup table", () => {
    const workspace: WorkatoWorkspaceValue = {
      ...baseWorkspace,
      recipes: [
        {
          id: "lookup-broken",
          name: "Lookup Broken",
          trigger: { adapter: "salesforce", event: "object_updated" },
          steps: [
            { keyword: "lookup", name: "Route", tableId: "nope", match: { region: "AMER" } },
          ],
        },
      ],
    };
    const diagnostics = validateWorkatoWorkspaceValue(workspace);
    expect(diagnostics.some((d) => d.message === "Unknown lookupTable: nope")).toBe(true);
  });

  it("flags a folder whose parent does not exist", () => {
    const workspace: WorkatoWorkspaceValue = {
      ...baseWorkspace,
      folders: [{ id: "orphan", name: "Orphan", parentId: "missing" }],
      connections: [],
      recipes: [],
    };
    const diagnostics = validateWorkatoWorkspaceValue(workspace);
    expect(diagnostics.some((d) => d.message === "Unknown folder: missing")).toBe(true);
  });
});

describe("workato provider DSL", () => {
  it("connects to the derived mock, pulls files, and re-plans clean", async () => {
    const store = createMemoryArtifactStore();
    const service = workatoProvider.makeDeployService({ store, projectId: "workato-yaml" });

    await Effect.runPromise(
      service.connect({
        environment: "production",
        authMethod: "token",
        credentials: { token: "secret" },
      } as any),
    );

    const pulled = await Effect.runPromise(service.pull());
    const paths = pulled.pulled.map((file) => file.path).sort();
    expect(paths).toContain("properties.yaml");
    expect(paths).toContain("folders/revops.yaml");
    expect(paths).toContain("connections/salesforce-prod.yaml");
    expect(paths).toContain("lookup-tables/region-routing.yaml");
    expect(paths).toContain("recipes/order-to-cash.yaml");
    expect(paths).toContain("recipes/notify-account-team.yaml");
    expect(paths).toContain("recipes/escalate-failed-order.yaml");

    const plan = await Effect.runPromise(service.plan());
    expect(plan.summary).toMatchObject({ create: 0, update: 0, delete: 0 });
  });
});
