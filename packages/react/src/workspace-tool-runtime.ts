import type {
  SchemaIdeFileEdit,
  SchemaIdePatchProposal,
  SchemaIdeToolRuntime,
} from "@schema-ide/agent";
import type { SchemaIdeReflection, SourceFile } from "@schema-ide/core";
import type { SchemaIdeReflectionDto } from "@schema-ide/protocol";
import type { SchemaIdeWorkspaceStore } from "./workspace-store";

export function createSchemaIdeWorkspaceToolRuntime(
  store: SchemaIdeWorkspaceStore,
): SchemaIdeToolRuntime {
  let proposalSequence = 0;

  return {
    readFile: (path) => store.filesRef.value.find((file) => file.path === path) ?? null,
    listFiles: () => store.filesRef.value.map((file) => file.path),
    searchFiles: (query) =>
      store.filesRef.value.flatMap((file) =>
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
    applyEdits: async (edits, options = {}) => {
      const before = store.filesRef.value;
      const files = applyEditsPreview(before, edits);
      const activeFile = edits[0]?.path ?? store.activeFileRef.value;
      const preview = await store.previewWorkspaceFiles({ files, activeFile });
      if (options.validate !== false && !preview.reflection.validationSummary.valid) {
        const firstError = preview.reflection.diagnostics.find(
          (diagnostic) => diagnostic.severity === "error",
        );
        throw new Error(firstError?.message ?? "Proposed edits did not validate.");
      }
      const response = await store.applyWorkspaceChange({ type: "replaceFiles", files });
      return {
        changedPaths: response.changedPaths,
        validation: preview.reflection.validationSummary,
      };
    },
    proposePatch: async (label, edits) => {
      const files = applyEditsPreview(store.filesRef.value, edits);
      const preview = await store.previewWorkspaceFiles({
        files,
        activeFile: edits[0]?.path ?? store.activeFileRef.value,
      });
      const proposal: SchemaIdePatchProposal = {
        id: `proposal-${++proposalSequence}`,
        label,
        edits,
        files,
        validation: preview.reflection.validationSummary,
        diagnostics: preview.reflection.diagnostics,
      };
      return proposal;
    },
    validateWorkspace: () => currentReflection(store.reflectionRef.value),
    getSchema: () => currentReflection(store.reflectionRef.value).schemas,
    getJsonSchema: (schemaId = null) => {
      const reflection = currentReflection(store.reflectionRef.value);
      return schemaId
        ? (reflection.schemas.find((schema) => schema.id === schemaId)?.jsonSchema ?? null)
        : reflection.activeJsonSchema;
    },
    getDiagnostics: () => currentReflection(store.reflectionRef.value).diagnostics,
  };
}

function currentReflection(reflection: SchemaIdeReflectionDto | null): SchemaIdeReflection {
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
