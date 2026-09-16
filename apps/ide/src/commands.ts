import { SchematicsArtifactProject } from "@schematics/protocol";
import { Effect, Schema } from "effect";
import { Command } from "foldkit";
import { Message } from "./message";

const errorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : String(error);

const emptyValidation = { valid: true, errorCount: 0, warningCount: 0, infoCount: 0 };

export const LoadWorkspace = Command.define("LoadWorkspace", {
  args: {},
  messages: [Message.CompletedLoad],
  execute: () =>
    Effect.gen(function* () {
      const client = yield* SchematicsArtifactProject;
      const [snapshot, capabilities] = yield* Effect.all([
        client.getSnapshot,
        client.getCapabilities,
      ]);
      const preview = yield* client.previewFiles({ files: snapshot.files });
      return Message.CompletedLoad({
        files: [...snapshot.files],
        revision: snapshot.revision,
        capabilities,
        validation: preview.reflection.validationSummary,
        error: "",
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          Message.CompletedLoad({
            files: [],
            revision: 0,
            capabilities: null,
            validation: emptyValidation,
            error: errorMessage(error),
          }),
        ),
      ),
    ),
});

export const SaveDocument = Command.define("SaveDocument", {
  args: { path: Schema.String, content: Schema.String },
  messages: [Message.CompletedSave],
  execute: ({ path, content }) =>
    Effect.gen(function* () {
      const client = yield* SchematicsArtifactProject;
      const applied = yield* client.applyChange({
        type: "writeFile",
        path,
        content,
        provenance: { actor: "user" },
      });
      const snapshot = yield* client.getSnapshot;
      return Message.CompletedSave({
        files: [...snapshot.files],
        revision: applied.revision,
        validation: applied.validationSummary,
        error: "",
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          Message.CompletedSave({
            files: [],
            revision: 0,
            validation: emptyValidation,
            error: errorMessage(error),
          }),
        ),
      ),
    ),
});
