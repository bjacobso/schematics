import { ArtifactProject as ArtifactProjectBase } from "@schema-ide/artifacts";
import {
  createArtifactProjectFromProjectSchema,
  createProjectSchemaFromArtifactProject,
} from "./artifacts";
import { Project as ProjectBase } from "./project-schema";

export const ArtifactProject: typeof ArtifactProjectBase & {
  readonly fromProjectSchema: typeof createArtifactProjectFromProjectSchema;
} = Object.assign({}, ArtifactProjectBase, {
  fromProjectSchema: createArtifactProjectFromProjectSchema,
});

export const Project: typeof ProjectBase & {
  readonly fromArtifactProject: typeof createProjectSchemaFromArtifactProject;
} = Object.assign({}, ProjectBase, {
  fromArtifactProject: createProjectSchemaFromArtifactProject,
});

export {
  Artifacts,
  SchemaIdeArtifactProject,
  SchemaIdeImageArtifact,
  SchemaIdePdfArtifact,
  SchemaIdeProjectFileArtifact,
  createArtifactProjectFromProjectSchema,
  createSchemaIdeArtifactRuntime,
  createProjectSchemaFromArtifactProject,
  validateSchemaIdeArtifacts,
  type CreateArtifactProjectFromProjectSchemaOptions,
  type CreateSchemaIdeArtifactRuntimeOptions,
  type CreateProjectSchemaFromArtifactProjectOptions,
  type SchemaIdeArtifactError,
  type SchemaIdeArtifactRuntime,
  type SchemaIdeImageFormat,
  type SchemaIdeImageInspection,
  type SchemaIdePdfField,
  type SchemaIdePdfFieldType,
  type SchemaIdePdfInspection,
  type SchemaIdePdfPageGeometry,
  type SchemaIdePdfPageText,
  type SchemaIdePdfTextExtraction,
  type ValidateSchemaIdeArtifactsOptions,
} from "./artifacts";
export { decodePdfBytes, extractPdfText, inspectPdf } from "./pdf";
export { inspectImage } from "./image";
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
  isProjectSchema,
  type ProjectDecodeOptions,
  type ProjectRouteId,
  type ProjectRouteMap,
  type ProjectRoutes,
  type ProjectRouteValue,
  type ProjectSchema,
  type ProjectValidationIssue,
  type FileEntry,
} from "./project-schema";
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
