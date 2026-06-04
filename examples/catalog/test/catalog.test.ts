import { createMemoryArtifactStore } from "@schematics/artifacts";
import { hasChanges } from "@schematics/alchemy";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { makeMockCatalogApi } from "../src/api";
import { makeCatalogConfigDeploy } from "../src/deploy";
import { inspectCatalogRelations, validateCatalogWorkspaceValue } from "../src/diagnostics";
import { nycPublicLibrarySeed } from "../src/seed";
import type { CatalogWorkspaceValue } from "../src/schema";

// The seed shape is the relation-workspace shape, so it doubles as the value the
// algebra graph is built from.
const workspace: CatalogWorkspaceValue = nycPublicLibrarySeed;

describe("catalog relations", () => {
  it("the NYPL fixture resolves with no diagnostics", () => {
    expect(validateCatalogWorkspaceValue(workspace)).toEqual([]);
  });

  it("exercises the full inspect surface with everything resolving", () => {
    const report = inspectCatalogRelations(workspace);
    expect(report.diagnostics).toEqual([]);
    expect(report.referenceDiagnostics).toEqual([]);
    expect(report.patchSuggestions).toEqual([]);
    // catalog + 2 branches + 3 authors + 3 shelves + 3 items + 3 editions +
    // 3 copies + 1 collection + 2 policies = 21 definitions.
    expect(report.definitions.length).toBe(21);
    // homeBranchId×3, author refs×3, copy.shelf×3, hold→copy×1, collection
    // items×2, collection shelves×2, policy primaryShelf×1 = 15 references.
    expect(report.references.length).toBe(15);
  });

  it("flags a dangling item reference and suggests creating it", () => {
    const broken: CatalogWorkspaceValue = {
      ...workspace,
      collections: [{ id: "x", name: "X", itemIds: ["does-not-exist"] }],
    };
    const report = inspectCatalogRelations(broken);
    expect(report.diagnostics.some((d) => d.code === "unresolved-ref")).toBe(true);
    expect(report.patchSuggestions.some((s) => s.id === "does-not-exist")).toBe(true);
    expect(
      validateCatalogWorkspaceValue(broken).some((d) => d.message.includes("Unknown item")),
    ).toBe(true);
  });

  it("flags a hold whose copy is not item-scoped-resolvable", () => {
    const item = workspace.items[0]!;
    const broken: CatalogWorkspaceValue = {
      ...workspace,
      items: [{ ...item, holds: [{ patron: "Z", copy: "99999999" }] }, ...workspace.items.slice(1)],
    };
    const diags = inspectCatalogRelations(broken).diagnostics;
    expect(diags.some((d) => d.code === "unresolved-ref")).toBe(true);
  });
});

describe("catalog deploy lifecycle", () => {
  it("pulls the NYPL catalog into a store", async () => {
    const store = createMemoryArtifactStore();
    const deploy = makeCatalogConfigDeploy({
      store,
      api: makeMockCatalogApi({ seed: nycPublicLibrarySeed }),
      projectId: "nyc-library-yaml",
    });
    const result = await Effect.runPromise(deploy.pull);
    const paths = result.pulled.map((p) => p.path);
    expect(paths).toContain("catalog.yaml");
    expect(paths.some((p) => p.startsWith("items/"))).toBe(true);
    expect(paths.some((p) => p.startsWith("policies/"))).toBe(true);
  });

  it("plans no changes after pulling (round-trips cleanly)", async () => {
    const store = createMemoryArtifactStore();
    const api = makeMockCatalogApi({ seed: nycPublicLibrarySeed });
    const deploy = makeCatalogConfigDeploy({ store, api, projectId: "nyc-library-yaml" });
    await Effect.runPromise(deploy.pull);
    const plan = await Effect.runPromise(deploy.plan);
    // Every resource round-trips, so the plan is all no-ops and applies nothing.
    expect(hasChanges(plan)).toBe(false);
    expect(plan.changes.every((change) => change.action === "noop")).toBe(true);
  });
});
