import { describe, expect, it } from "vitest";
import { validateToyWorkspaceValue, type ToyWorkspaceValue } from "../src/index";

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
