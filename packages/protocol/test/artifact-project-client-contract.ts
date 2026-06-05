import { expect, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import type {
  SchematicsArtifactProjectService,
  ArtifactProjectSnapshot,
  SchematicsDiagnosticDto,
} from "../src";

export interface ArtifactProjectClientContractSubject {
  readonly artifactProject: SchematicsArtifactProjectService;
  readonly cleanup?: Effect.Effect<void> | undefined;
}

export interface ArtifactProjectClientContractOptions {
  readonly name: string;
  readonly createSubject: Effect.Effect<ArtifactProjectClientContractSubject>;
  readonly existingPath: string;
  readonly updatedContent: string;
  readonly replacedContent?: string | undefined;
  readonly invalidContent?: string | undefined;
  readonly createdPath?: string | undefined;
  readonly renamedPath?: string | undefined;
}

export function defineArtifactProjectClientContract({
  name,
  createSubject,
  existingPath,
  updatedContent,
  replacedContent = '{"id":"replaced"}\n',
  invalidContent = '{"id":1}\n',
  createdPath = "contract-created.json",
  renamedPath = "contract-renamed.json",
}: ArtifactProjectClientContractOptions) {
  it.effect(`${name} satisfies the artifact project service contract`, () =>
    Effect.scoped(
      Effect.gen(function* () {
        const subject = yield* Effect.acquireRelease(
          createSubject,
          (subject) => subject.cleanup ?? Effect.void,
        );
        const capabilities = yield* subject.artifactProject.getCapabilities;
        const initial = yield* subject.artifactProject.getSnapshot;

        expect(capabilities.features.watch).toBe(true);
        expect(initial.files.some((file) => file.path === existingPath)).toBe(true);
        const artifactWatchEvents = yield* subject.artifactProject.watchArtifactProject.pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.timeout("2 seconds"),
        );
        expect([...artifactWatchEvents].map((event) => event.type)).toEqual([
          "capabilities",
          "snapshot",
        ]);
        const artifactRefs = yield* subject.artifactProject.listArtifactRefs;
        expect(
          artifactRefs.artifacts.some(
            (ref) => ref._tag === "ProjectFile" && ref.path === existingPath,
          ),
        ).toBe(true);

        const artifactCapabilities = yield* subject.artifactProject.getArtifactCapabilities({
          ref: { _tag: "ProjectFile", path: existingPath },
        });
        expect(artifactCapabilities.capabilities.map((capability) => capability.view)).toContain(
          "sourceText",
        );

        const artifactSource = yield* subject.artifactProject.readArtifactView({
          ref: { _tag: "ProjectFile", path: existingPath },
          view: "sourceText",
        });
        expect(artifactSource.value).toBe(fileContent(initial, existingPath));

        if (subject.artifactProject.readArtifactViews) {
          const artifactViews = yield* subject.artifactProject.readArtifactViews({
            views: [
              {
                ref: { _tag: "ProjectFile", path: existingPath },
                view: "sourceText",
              },
              {
                ref: { _tag: "Project" },
                view: "diagnostics",
              },
            ],
          });
          expect(artifactViews.views[0]?.value).toBe(fileContent(initial, existingPath));
          expect(Array.isArray(artifactViews.views[1]?.value)).toBe(true);
        }

        const unsupportedArtifactView = yield* Effect.flip(
          subject.artifactProject.readArtifactView({
            ref: { _tag: "ProjectFile", path: existingPath },
            view: "unsupported",
          }),
        );
        expect(unsupportedArtifactView.code).toBe("unsupported");

        const writeResult = yield* subject.artifactProject.applyChange({
          type: "writeFile",
          path: existingPath,
          content: updatedContent,
        });
        const written = yield* subject.artifactProject.getSnapshot;

        expect(writeResult.changedPaths).toContain(existingPath);
        expect(fileContent(written, existingPath)).toBe(updatedContent);

        const artifactWriteResult = yield* subject.artifactProject.applyArtifactChange({
          type: "writeSource",
          ref: { _tag: "ProjectFile", path: existingPath },
          content: updatedContent,
        });
        const artifactWrittenSource = yield* subject.artifactProject.readArtifactView({
          ref: { _tag: "ProjectFile", path: existingPath },
          view: "sourceText",
        });
        expect(artifactWriteResult.changedPaths).toContain(existingPath);
        expect(fileContent(yield* subject.artifactProject.getSnapshot, existingPath)).toBe(
          updatedContent,
        );
        expect(artifactWrittenSource.value).toBe(updatedContent);

        if (capabilities.features.write) {
          yield* subject.artifactProject.applyChange({
            type: "createFile",
            path: createdPath,
            content: "{}\n",
          });
          expect(fileContent(yield* subject.artifactProject.getSnapshot, createdPath)).toBe("{}\n");
        }

        if (capabilities.features.rename) {
          yield* subject.artifactProject.applyChange({
            type: "renameFile",
            fromPath: createdPath,
            toPath: renamedPath,
          });
          const renamed = yield* subject.artifactProject.getSnapshot;
          expect(fileContent(renamed, createdPath)).toBeUndefined();
          expect(fileContent(renamed, renamedPath)).toBe("{}\n");
        }

        if (capabilities.features.delete) {
          yield* subject.artifactProject.applyChange({ type: "deleteFile", path: renamedPath });
          expect(
            fileContent(yield* subject.artifactProject.getSnapshot, renamedPath),
          ).toBeUndefined();
        }

        const beforeReplace = yield* subject.artifactProject.getSnapshot;
        const replacementFiles = beforeReplace.files.map((file) =>
          file.path === existingPath ? { ...file, content: replacedContent } : file,
        );
        const preview = yield* subject.artifactProject.previewFiles({
          files: replacementFiles,
          activeFile: existingPath,
        });
        expect(preview.reflection.files.find((file) => file.path === existingPath)?.content).toBe(
          replacedContent,
        );
        const replaceResult = yield* subject.artifactProject.applyChange({
          type: "replaceFiles",
          files: replacementFiles,
        });
        expect(replaceResult.changedPaths).toContain(existingPath);
        expect(fileContent(yield* subject.artifactProject.getSnapshot, existingPath)).toBe(
          replacedContent,
        );

        const invalidResult = yield* subject.artifactProject.applyChange({
          type: "writeFile",
          path: existingPath,
          content: invalidContent,
        });
        const invalidDiagnostics = yield* subject.artifactProject.readArtifactView({
          ref: { _tag: "Project" },
          view: "diagnostics",
        });
        expect(invalidResult.validationSummary.valid).toBe(false);
        expect(
          (invalidDiagnostics.value as readonly SchematicsDiagnosticDto[]).some(
            (diagnostic) => diagnostic.path === existingPath,
          ),
        ).toBe(true);
      }),
    ),
  );
}

function fileContent(snapshot: ArtifactProjectSnapshot, path: string): string | undefined {
  return snapshot.files.find((file) => file.path === path)?.content;
}
