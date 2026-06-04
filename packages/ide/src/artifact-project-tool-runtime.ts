import type {
  SchematicsFileEdit,
  SchematicsHostRuntime,
  SchematicsPatchProposal,
} from "@schematics/agent";
import type { SchematicsReflection, SourceFile } from "@schematics/core";
import type { SchematicsReflectionDto } from "@schematics/protocol";
import { Effect } from "effect";
import type { SchematicsArtifactProjectStore } from "./artifact-project-store";

export function createSchematicsArtifactProjectToolRuntime(
  store: SchematicsArtifactProjectStore,
): SchematicsHostRuntime {
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
    writeFile: async (file, options) => {
      await Effect.runPromise(
        store.applyProjectChange({
          type: "writeFile",
          ...file,
          ...(options?.provenance ? { provenance: options.provenance } : {}),
        }),
      );
    },
    createFile: async (file, options) => {
      await Effect.runPromise(
        store.applyProjectChange({
          type: "createFile",
          ...file,
          ...(options?.provenance ? { provenance: options.provenance } : {}),
        }),
      );
    },
    deleteFile: async (path, options) => {
      await Effect.runPromise(
        store.applyProjectChange({
          type: "deleteFile",
          path,
          ...(options?.provenance ? { provenance: options.provenance } : {}),
        }),
      );
    },
    renameFile: async (fromPath, toPath, options) => {
      await Effect.runPromise(
        store.applyProjectChange({
          type: "renameFile",
          fromPath,
          toPath,
          ...(options?.provenance ? { provenance: options.provenance } : {}),
        }),
      );
    },
    applyEdits: async (edits, options = {}) => {
      const before = store.filesRef.value;
      const files = applyEditsPreview(before, edits);
      const activeFile = edits[0]?.path ?? store.activeFileRef.value;
      const preview = await Effect.runPromise(store.previewProjectFiles({ files, activeFile }));
      if (options.validate !== false && !preview.reflection.validationSummary.valid) {
        const firstError = preview.reflection.diagnostics.find(
          (diagnostic) => diagnostic.severity === "error",
        );
        throw new Error(firstError?.message ?? "Proposed edits did not validate.");
      }
      const response = await Effect.runPromise(
        store.applyProjectChange({
          type: "replaceFiles",
          files,
          ...(options.provenance ? { provenance: options.provenance } : {}),
        }),
      );
      return {
        changedPaths: response.changedPaths,
        validation: preview.reflection.validationSummary,
      };
    },
    proposePatch: async (label, edits) => {
      const files = applyEditsPreview(store.filesRef.value, edits);
      const preview = await Effect.runPromise(
        store.previewProjectFiles({
          files,
          activeFile: edits[0]?.path ?? store.activeFileRef.value,
        }),
      );
      const proposal: SchematicsPatchProposal = {
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
    getDiagnostics: () => store.diagnosticsRef.value,
    listArtifacts: () => Effect.runPromise(store.listArtifactRefs),
    getArtifactCapabilities: (ref) => Effect.runPromise(store.getArtifactCapabilities({ ref })),
    readArtifactView: (request) => Effect.runPromise(store.readArtifactView(request)),
    writeArtifactSource: async (ref, content, options) => {
      const response = await Effect.runPromise(
        store.applyArtifactChange({
          type: "writeSource",
          ref,
          content,
          ...(options?.provenance ? { provenance: options.provenance } : {}),
        }),
      );
      return {
        changedPaths: response.changedPaths,
        validation: response.validationSummary,
      };
    },
  };
}

function currentReflection(reflection: SchematicsReflectionDto | null): SchematicsReflection {
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
  return reflection as SchematicsReflection;
}

function applyEditsPreview(
  files: readonly SourceFile[],
  edits: readonly SchematicsFileEdit[],
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
