import { describe, expect, it } from "vitest";
import { Message } from "./message";
import { initialModel } from "./model";
import { update } from "./update";

const loaded = update(
  initialModel,
  Message.CompletedLoad({
    files: [{ path: "cards/welcome.yaml", content: "name: Welcome\n" }],
    revision: 7,
    capabilities: {
      mode: "memory",
      project: { id: "test", title: "Test", readOnly: false },
      agent: { enabled: false, reason: "test" },
      features: {
        watch: true,
        write: true,
        rename: true,
        delete: true,
        history: false,
        previews: true,
      },
    },
    validation: { valid: true, errorCount: 0, warningCount: 0, infoCount: 0 },
    error: "",
  }),
).model;

describe("Foldkit IDE update", () => {
  it("keeps editing pure and describes persistence as an Effect command", () => {
    const changed = update(loaded, Message.ChangedDraft({ value: "name: Hello\n" })).model;
    const requested = update(changed, Message.RequestedSave());

    expect(changed.draft).toBe("name: Hello\n");
    expect(changed.savedContent).toBe("name: Welcome\n");
    expect(requested.model.status).toBe("Saving");
    expect(requested.commands).toHaveLength(1);
  });

  it("only publishes saved, valid declarations", () => {
    expect(update(loaded, Message.RequestedPublish()).commands).toHaveLength(1);

    const changed = update(loaded, Message.ChangedDraft({ value: "name: Hello\n" })).model;
    expect(update(changed, Message.RequestedPublish()).commands).toBeUndefined();
  });
});
