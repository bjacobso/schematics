import type {
  SchemaIdeFileEdit,
  SchemaIdePatchProposal,
  SchemaIdeToolRuntime,
} from "@schema-ide/agent";
import type { SchemaIdeReflection, SourceFile } from "@schema-ide/core";
import type { SchemaIdeWorkspaceStore, SchemaIdeWorkspaceState } from "./workspace-store";

export function createSchemaIdeWorkspaceToolRuntime(
  store: SchemaIdeWorkspaceStore,
): SchemaIdeToolRuntime {
  let proposalSequence = 0;

  return {
    readFile: (path) => currentFiles(store.stateRef.value).find((file) => file.path === path) ?? null,
    listFiles: () => currentFiles(store.stateRef.value).map((file) => file.path),
    searchFiles: (query) =>
      currentFiles(store.stateRef.value).flatMap((file) =>
        file.content
          .split(/\r?\n/)
          .map((line, index) => ({ path: file.path, line: index + 1, content: line }))
          .filter((line) => line.content.includes(query)),
      ),
    writeFile: async (file) => {
      await store.applyWorkspaceChange({ type: "writeFile", ...file });
    },
    createFile: async (file) => {
      await store.applyWorkspaceChange({ type: "createFile", ...file });
    },
    deleteFile: async (path) => {
      await store.applyWorkspaceChange({ type: "deleteFile", path });
    },
    renameFile: async (fromPath, toPath) => {
      await store.applyWorkspaceChange({ type: "renameFile", fromPath, toPath });
    },
    applyEdits: async (edits) => {
      const before = currentFiles(store.stateRef.value);
      const files = applyEditsPreview(before, edits);
      const response = await store.applyWorkspaceChange({ type: "replaceFiles", files });
      return {
        changedPaths: response.changedPaths,
        validation: response.validationSummary,
      };
    },
    proposePatch: (label, edits) => {
      const files = applyEditsPreview(currentFiles(store.stateRef.value), edits);
      const reflection = currentReflection(store.stateRef.value);
      const proposal: SchemaIdePatchProposal = {
        id: `proposal-${++proposalSequence}`,
        label,
        edits,
        files,
        validation: reflection.validationSummary,
        diagnostics: reflection.diagnostics,
      };
      return proposal;
    },
    validateWorkspace: () => currentReflection(store.stateRef.value),
    getSchema: () => currentReflection(store.stateRef.value).schemas,
    getJsonSchema: (schemaId = null) => {
      const reflection = currentReflection(store.stateRef.value);
      return schemaId
        ? (reflection.schemas.find((schema) => schema.id === schemaId)?.jsonSchema ?? null)
        : reflection.activeJsonSchema;
    },
    getDiagnostics: () => currentReflection(store.stateRef.value).diagnostics,
  };
}

function currentFiles(state: SchemaIdeWorkspaceState): readonly SourceFile[] {
  const files = state.snapshot?.files ?? [];
  const draftEntries = Object.entries(state.drafts);
  if (!draftEntries.length) return files;
  return files.map((file) =>
    Object.prototype.hasOwnProperty.call(state.drafts, file.path)
      ? { ...file, content: state.drafts[file.path] ?? file.content }
      : file,
  );
}

function currentReflection(state: SchemaIdeWorkspaceState): SchemaIdeReflection {
  const reflection = state.snapshot?.reflection;
  if (!reflection) {
    return {
      mode: "workspace",
      activeFile: null,
      activeFormat: "json",
      files: [],
      schemas: [],
      activeJsonSchema: null,
      decodedValue: null,
      diagnostics: [],
      validationSummary: { valid: true, errorCount: 0, warningCount: 0, infoCount: 0 },
      routeMatches: [],
    };
  }
  return reflection as SchemaIdeReflection;
}

function applyEditsPreview(
  files: readonly SourceFile[],
  edits: readonly SchemaIdeFileEdit[],
): readonly SourceFile[] {
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  for (const edit of edits) {
    if (edit.create && byPath.has(edit.path)) {
      throw new Error(`File already exists: ${edit.path}`);
    }
    byPath.set(edit.path, edit.content);
  }
  return [...byPath.entries()]
    .map(([path, content]) => ({ path, content }))
    .sort((left, right) => left.path.localeCompare(right.path));
}
