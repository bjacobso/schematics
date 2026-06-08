export { defineResource } from "./resource";
export type {
  NormalizedResource,
  ResourceCrud,
  ResourceDefinition,
  ResourceWriteOps,
} from "./resource";
export {
  deriveArtifactProject,
  deriveProjectSchema,
  deriveWorkspaceDiagnostics,
  deriveWorkspaceSchema,
  type DeriveArtifactProjectOptions,
  type WorkspaceDiagnosticsOptions,
} from "./derive";
