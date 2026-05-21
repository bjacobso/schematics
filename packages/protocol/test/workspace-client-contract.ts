import { expect, it } from "@effect/vitest";
import type { SchemaIdeWorkspaceClient, WorkspaceSnapshot } from "../src";

export interface WorkspaceClientContractSubject {
  readonly client: SchemaIdeWorkspaceClient;
  readonly cleanup?: (() => void | Promise<void>) | undefined;
}

export interface WorkspaceClientContractOptions {
  readonly name: string;
  readonly createSubject: () => WorkspaceClientContractSubject | Promise<WorkspaceClientContractSubject>;
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
  it(`${name} satisfies the workspace client contract`, async () => {
    const subject = await createSubject();
    const snapshots: WorkspaceSnapshot[] = [];
    const subscription = subject.client.watchWorkspace((event) => {
      if (event.type === "snapshot") snapshots.push(event.snapshot);
    });

    try {
      const capabilities = await subject.client.getCapabilities();
      const initial = await subject.client.getSnapshot();

      expect(capabilities.features.watch).toBe(true);
      expect(initial.files.some((file) => file.path === existingPath)).toBe(true);

      const writeResult = await subject.client.applyChange({
        type: "writeFile",
        path: existingPath,
        content: updatedContent,
      });
      const written = await subject.client.getSnapshot();

      expect(writeResult.changedPaths).toContain(existingPath);
      expect(fileContent(written, existingPath)).toBe(updatedContent);
      await expectSnapshot(snapshots, (snapshot) =>
        fileContent(snapshot, existingPath) === updatedContent,
      );

      if (capabilities.features.write) {
        await subject.client.applyChange({
          type: "createFile",
          path: createdPath,
          content: "{}\n",
        });
        expect(fileContent(await subject.client.getSnapshot(), createdPath)).toBe("{}\n");
      }

      if (capabilities.features.rename) {
        await subject.client.applyChange({
          type: "renameFile",
          fromPath: createdPath,
          toPath: renamedPath,
        });
        const renamed = await subject.client.getSnapshot();
        expect(fileContent(renamed, createdPath)).toBeUndefined();
        expect(fileContent(renamed, renamedPath)).toBe("{}\n");
      }

      if (capabilities.features.delete) {
        await subject.client.applyChange({ type: "deleteFile", path: renamedPath });
        expect(fileContent(await subject.client.getSnapshot(), renamedPath)).toBeUndefined();
      }

      const beforeReplace = await subject.client.getSnapshot();
      const replacementFiles = beforeReplace.files.map((file) =>
        file.path === existingPath ? { ...file, content: replacedContent } : file,
      );
      const preview = await subject.client.previewFiles({
        files: replacementFiles,
        activeFile: existingPath,
      });
      expect(preview.reflection.files.find((file) => file.path === existingPath)?.content).toBe(
        replacedContent,
      );
      const replaceResult = await subject.client.applyChange({
        type: "replaceFiles",
        files: replacementFiles,
      });
      expect(replaceResult.changedPaths).toContain(existingPath);
      expect(fileContent(await subject.client.getSnapshot(), existingPath)).toBe(replacedContent);

      const invalidResult = await subject.client.applyChange({
        type: "writeFile",
        path: existingPath,
        content: invalidContent,
      });
      const invalidSnapshot = await subject.client.getSnapshot();
      expect(invalidResult.validationSummary.valid).toBe(false);
      expect(
        invalidSnapshot.reflection.diagnostics.some((diagnostic) => diagnostic.path === existingPath),
      ).toBe(true);
    } finally {
      subscription.unsubscribe();
      await subject.cleanup?.();
    }
  });
}

function fileContent(snapshot: WorkspaceSnapshot, path: string): string | undefined {
  return snapshot.files.find((file) => file.path === path)?.content;
}

async function expectSnapshot(
  snapshots: readonly WorkspaceSnapshot[],
  predicate: (snapshot: WorkspaceSnapshot) => boolean,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (snapshots.some(predicate)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(snapshots.some(predicate)).toBe(true);
}
