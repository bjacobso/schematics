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
export {
  deriveResourceHandler,
  makeProviderConfigDeploy,
  type MakeProviderConfigDeployOptions,
} from "./reconcile";
export {
  deriveMockTransport,
  type DeriveMockOptions,
  type DerivedMockTransport,
  type MockApiCall,
} from "./mock";
