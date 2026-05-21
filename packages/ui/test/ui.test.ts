import { describe, expect, it } from "@effect/vitest";
import { Badge, Button, ScrollArea, Textarea, cn } from "../src";

describe("schema-ide-ui", () => {
  it("exports local UI primitives", () => {
    expect(Button).toBeTypeOf("function");
    expect(Badge).toBeTypeOf("function");
    expect(ScrollArea).toBeTypeOf("function");
    expect(Textarea).toBeTypeOf("function");
    expect(cn("a", false, "b")).toBe("a b");
  });
});
