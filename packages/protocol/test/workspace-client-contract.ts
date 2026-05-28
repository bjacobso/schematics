import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { SchemaIdeWorkspaceService, WorkspaceSnapshot } from "../src";

export interface WorkspaceClientContractSubject {
  readonly workspace: SchemaIdeWorkspaceService;
  readonly cleanup?: Effect.Effect<void> | undefined;
}

export interface WorkspaceClientContractOptions {
  readonly name: string;
  readonly createSubject: Effect.Effect<WorkspaceClientContractSubject>;
  readonly existingPath: string;
  readonly updatedContent: string;
  readonly replacedContent?: string | undefined;
  readonly invalidContent?: string | undefined;
  readonly createdPath?: string | undefined;
  readonly renamedPath?: string | undefined;
}

export function defineWorkspaceClientContract({
  name,
  createSubject,
  existingPath,
  updatedContent,
  replacedContent = '{"id":"replaced"}\n',
  invalidContent = '{"id":1}\n',
  createdPath = "contract-created.json",
  renamedPath = "contract-renamed.json",
}: WorkspaceClientContractOptions) {
  it.effect(`${name} satisfies the workspace service contract`, () =>
    Effect.scoped(
      Effect.gen(function* () {
        const subject = yield* Effect.acquireRelease(
          createSubject,
          (subject) => subject.cleanup ?? Effect.void,
        );
        const capabilities = yield* subject.workspace.getCapabilities;
        const initial = yield* subject.workspace.getSnapshot;

        expect(capabilities.features.watch).toBe(true);
        expect(initial.files.some((file) => file.path === existingPath)).toBe(true);
        const artifactRefs = yield* subject.workspace.listArtifactRefs;
        expect(
          artifactRefs.artifacts.some(
            (ref) => ref._tag === "WorkspaceFile" && ref.path === existingPath,
          ),
        ).toBe(true);

        const artifactCapabilities = yield* subject.workspace.getArtifactCapabilities({
          ref: { _tag: "WorkspaceFile", path: existingPath },
        });
        expect(artifactCapabilities.capabilities.map((capability) => capability.view)).toContain(
          "sourceText",
        );

        const artifactSource = yield* subject.workspace.readArtifactView({
          ref: { _tag: "WorkspaceFile", path: existingPath },
          view: "sourceText",
        });
        expect(artifactSource.value).toBe(fileContent(initial, existingPath));

        const unsupportedArtifactView = yield* Effect.flip(
          subject.workspace.readArtifactView({
            ref: { _tag: "WorkspaceFile", path: existingPath },
            view: "unsupported",
          }),
        );
        expect(unsupportedArtifactView.code).toBe("unsupported");

        const writeResult = yield* subject.workspace.applyChange({
          type: "writeFile",
          path: existingPath,
          content: updatedContent,
        });
        const written = yield* subject.workspace.getSnapshot;

        expect(writeResult.changedPaths).toContain(existingPath);
        expect(fileContent(written, existingPath)).toBe(updatedContent);

        const artifactWriteResult = yield* subject.workspace.applyArtifactChange({
          type: "writeSource",
          ref: { _tag: "WorkspaceFile", path: existingPath },
          content: updatedContent,
        });
        expect(artifactWriteResult.changedPaths).toContain(existingPath);
        expect(fileContent(yield* subject.workspace.getSnapshot, existingPath)).toBe(
          updatedContent,
        );

        if (capabilities.features.write) {
          yield* subject.workspace.applyChange({
            type: "createFile",
            path: createdPath,
            content: "{}\n",
          });
          expect(fileContent(yield* subject.workspace.getSnapshot, createdPath)).toBe("{}\n");
        }

        if (capabilities.features.rename) {
          yield* subject.workspace.applyChange({
            type: "renameFile",
            fromPath: createdPath,
            toPath: renamedPath,
          });
          const renamed = yield* subject.workspace.getSnapshot;
          expect(fileContent(renamed, createdPath)).toBeUndefined();
          expect(fileContent(renamed, renamedPath)).toBe("{}\n");
        }

        if (capabilities.features.delete) {
          yield* subject.workspace.applyChange({ type: "deleteFile", path: renamedPath });
          expect(fileContent(yield* subject.workspace.getSnapshot, renamedPath)).toBeUndefined();
        }

        const beforeReplace = yield* subject.workspace.getSnapshot;
        const replacementFiles = beforeReplace.files.map((file) =>
          file.path === existingPath ? { ...file, content: replacedContent } : file,
        );
        const preview = yield* subject.workspace.previewFiles({
          files: replacementFiles,
          activeFile: existingPath,
        });
        expect(preview.reflection.files.find((file) => file.path === existingPath)?.content).toBe(
          replacedContent,
        );
        const replaceResult = yield* subject.workspace.applyChange({
          type: "replaceFiles",
          files: replacementFiles,
        });
        expect(replaceResult.changedPaths).toContain(existingPath);
        expect(fileContent(yield* subject.workspace.getSnapshot, existingPath)).toBe(
          replacedContent,
        );

        const invalidResult = yield* subject.workspace.applyChange({
          type: "writeFile",
          path: existingPath,
          content: invalidContent,
        });
        const invalidSnapshot = yield* subject.workspace.getSnapshot;
        expect(invalidResult.validationSummary.valid).toBe(false);
        expect(
          invalidSnapshot.reflection.diagnostics.some(
            (diagnostic) => diagnostic.path === existingPath,
          ),
        ).toBe(true);
      }),
    ),
  );
}

function fileContent(snapshot: WorkspaceSnapshot, path: string): string | undefined {
  return snapshot.files.find((file) => file.path === path)?.content;
}
