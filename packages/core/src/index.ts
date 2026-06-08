import { ArtifactProject as ArtifactProjectBase } from "@schematics/artifacts";
export { classifyProjectPath } from "@schematics/artifacts";
export type { ArtifactProjectFileClass } from "@schematics/artifacts";
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
  SchematicsArtifactProject,
  SchematicsImageArtifact,
  SchematicsPdfArtifact,
  SchematicsProjectFileArtifact,
  createArtifactProjectFromProjectSchema,
  createSchematicsArtifactRuntime,
  createProjectSchemaFromArtifactProject,
  validateSchematicsArtifacts,
  type CreateArtifactProjectFromProjectSchemaOptions,
  type CreateSchematicsArtifactRuntimeOptions,
  type CreateProjectSchemaFromArtifactProjectOptions,
  type SchematicsArtifactError,
  type SchematicsArtifactRuntime,
  type SchematicsImageFormat,
  type SchematicsImageInspection,
  type SchematicsPdfField,
  type SchematicsPdfFieldType,
  type SchematicsPdfInspection,
  type SchematicsPdfPageGeometry,
  type SchematicsPdfPageText,
  type SchematicsPdfTextExtraction,
  type ValidateSchematicsArtifactsOptions,
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
  validateSchematicsValue,
  validateSingleDocument,
  type SchematicsInputSchema,
} from "./validation";
export {
  buildReferenceIndex,
  getSchematicsCompletions,
  getSchematicsDefinitions,
  getSchematicsHover,
  getSchematicsQuickFixes,
  getSchematicsReferences,
  type SchematicsCompletionItem,
  type SchematicsCompletionResult,
  type SchematicsDefinition,
  type SchematicsHover,
  type SchematicsQuickFix,
  type SchematicsReference,
  type SchematicsWorkspaceTextEdit,
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
  SchematicsEditorMode,
  SchematicsFlavor,
  SchematicsFlavorAssistant,
  SchematicsFlavorDeploy,
  SchematicsFlavorDeployOptions,
} from "./flavor";
export type {
  AnySchema,
  ReflectedSchema,
  RouteMatch,
  SchematicsDiagnostic,
  SchematicsDiagnosticSource,
  SchematicsDocumentCodec,
  SchematicsDocumentFormat,
  SchematicsParseFailure,
  SchematicsParseResult,
  SchematicsParseSuccess,
  SchematicsReflection,
  SchematicsValidationSummary,
  SourceFile,
  SourceTree,
  ValidationResult,
} from "./types";
