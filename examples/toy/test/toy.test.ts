import { createMemoryArtifactStore } from "@schematics/artifacts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { toyProvider, validateToyWorkspaceValue, type ToyWorkspaceValue } from "../src/index";

describe("toy diagnostics", () => {
  it("a valid workspace has no diagnostics", () => {
    const workspace: ToyWorkspaceValue = {
      cards: [{ id: "welcome", title: "Welcome" }],
      decks: [{ id: "onboarding", name: "Onboarding", cardIds: ["welcome"] }],
    };
    expect(validateToyWorkspaceValue(workspace)).toEqual([]);
  });

  it("flags an unresolved card reference", () => {
    const workspace: ToyWorkspaceValue = {
      cards: [{ id: "welcome", title: "Welcome" }],
      decks: [{ id: "onboarding", name: "Onboarding", cardIds: ["welcome", "missing-card"] }],
    };
    const diagnostics = validateToyWorkspaceValue(workspace);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toBe("Unknown card: missing-card");
  });

  it("flags a duplicate card id", () => {
    const workspace: ToyWorkspaceValue = {
      cards: [
        { id: "welcome", title: "Welcome" },
        { id: "welcome", title: "Welcome (again)" },
      ],
      decks: [],
    };
    const diagnostics = validateToyWorkspaceValue(workspace);
    expect(diagnostics.some((d) => d.message === "Duplicate card id: welcome")).toBe(true);
  });
});

describe("toy provider DSL", () => {
  it("connects to the derived mock, pulls files, and re-plans clean", async () => {
    const store = createMemoryArtifactStore();
    const service = toyProvider.makeDeployService({ store, projectId: "toy-yaml" });

    await Effect.runPromise(
      service.connect({
        environment: "localhost",
        authMethod: "token",
        credentials: { token: "secret" },
      } as any),
    );

    const pulled = await Effect.runPromise(service.pull());
    const paths = pulled.pulled.map((file) => file.path).sort();
    expect(paths).toContain("cards/welcome.yaml");
    expect(paths).toContain("cards/setup.yaml");
    expect(paths).toContain("decks/onboarding.yaml");

    const plan = await Effect.runPromise(service.plan());
    expect(plan.summary).toMatchObject({ create: 0, update: 0, delete: 0 });
  });
});
