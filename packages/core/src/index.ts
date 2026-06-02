import { ArtifactProject as ArtifactProjectBase } from "@schema-ide/artifacts";
import {
  createArtifactProjectFromWorkspace,
  createWorkspaceFromArtifactProject,
} from "./artifacts";
import { Workspace as WorkspaceBase } from "./workspace-schema";

export const ArtifactProject: typeof ArtifactProjectBase & {
  readonly fromWorkspace: typeof createArtifactProjectFromWorkspace;
} = Object.assign({}, ArtifactProjectBase, {
  fromWorkspace: createArtifactProjectFromWorkspace,
});

export const Workspace: typeof WorkspaceBase & {
  readonly fromArtifactProject: typeof createWorkspaceFromArtifactProject;
} = Object.assign({}, WorkspaceBase, {
  fromArtifactProject: createWorkspaceFromArtifactProject,
});

export {
  Artifacts,
  SchemaIdeArtifactProject,
  SchemaIdePdfArtifact,
  SchemaIdeProjectFileArtifact,
  createArtifactProjectFromWorkspace,
  createSchemaIdeArtifactRuntime,
  createWorkspaceFromArtifactProject,
  validateSchemaIdeArtifacts,
  type CreateArtifactProjectFromWorkspaceOptions,
  type CreateSchemaIdeArtifactRuntimeOptions,
  type CreateWorkspaceFromArtifactProjectOptions,
  type SchemaIdeArtifactError,
  type SchemaIdeArtifactRuntime,
  type SchemaIdePdfInspection,
  type ValidateSchemaIdeArtifactsOptions,
} from "./artifacts";
export {
  JsonDocumentCodec,
  YamlDocumentCodec,
  BuiltInDocumentCodecs,
  codecForFormat,
  codecForPath,
  formatForPath,
  parseDocument,
  stringifyDocument,
  parseYaml,
  decodeYamlEither,
} from "./document-codec";
export { summarizeDiagnostics, parseErrorToDiagnostics } from "./diagnostics";
export {
  isWorkspaceSchema,
  type WorkspaceDecodeOptions,
  type WorkspaceRouteId,
  type WorkspaceRouteMap,
  type WorkspaceRoutes,
  type WorkspaceRouteValue,
  type WorkspaceSchema,
  type WorkspaceValidationIssue,
  type FileEntry,
} from "./workspace-schema";
export {
  createReflection,
  sourceTreeFromFiles,
  validateSchemaIdeValue,
  validateSingleDocument,
  type SchemaIdeInputSchema,
} from "./validation";
export {
  buildReferenceIndex,
  getSchemaIdeCompletions,
  getSchemaIdeDefinitions,
  getSchemaIdeHover,
  getSchemaIdeQuickFixes,
  getSchemaIdeReferences,
  type SchemaIdeCompletionItem,
  type SchemaIdeCompletionResult,
  type SchemaIdeDefinition,
  type SchemaIdeHover,
  type SchemaIdeQuickFix,
  type SchemaIdeReference,
  type SchemaIdeWorkspaceTextEdit,
} from "./schema-language-service";
export {
  createEmptyFS,
  deleteFile,
  listFiles,
  normalizePath,
  readFile,
  sourceFilesToVirtualFs,
  virtualFsToSourceTree,
  writeFile,
  type VirtualFile,
  type VirtualFSState,
} from "./virtual-fs";
export { createMemorySourceRepository, type SourceRepository } from "./source-repository";
export type {
  AnySchema,
  ReflectedSchema,
  RouteMatch,
  SchemaIdeDiagnostic,
  SchemaIdeDiagnosticSource,
  SchemaIdeDocumentCodec,
  SchemaIdeDocumentFormat,
  SchemaIdeParseFailure,
  SchemaIdeParseResult,
  SchemaIdeParseSuccess,
  SchemaIdeReflection,
  SchemaIdeValidationSummary,
  SourceFile,
  SourceTree,
  ValidationResult,
} from "./types";
