// Public-library catalog example — a top-to-bottom Effect tour of the relation
// algebra + the config-as-code lifecycle. Node-less surface; the deploy CLI and
// IDE CLI live at the `./deploy` and `./cli` subpaths.

export * from "./schema";
export {
  inspectCatalogRelations,
  validateCatalogWorkspaceValue,
  getRelationAnnotation,
  type CatalogRelationReport,
} from "./diagnostics";
export {
  CatalogArtifactProject,
  CatalogProjectBaseSchema,
  CatalogProjectSchema,
} from "./project";
export {
  CatalogApiError,
  makeMockCatalogApi,
  type CatalogApi,
  type CatalogApiCall,
  type CatalogSeed,
  type CrudApi,
  type MockCatalogApi,
  type MockCatalogApiOptions,
} from "./api";
export {
  CATALOG_KINDS,
  makeCatalogConfigDeploy,
  type CatalogConfigDeployOptions,
} from "./deploy";
export {
  makeCatalogDeployService,
  type CatalogDeployServiceOptions,
} from "./deploy-service";
export {
  CATALOG_CONNECTION_OPTIONS,
  CatalogAuthMethodIdSchema,
  CatalogEnvironmentIdSchema,
  type CatalogAuthMethodId,
  type CatalogEnvironmentId,
} from "./connection";
export {
  catalogSeeds,
  nycPublicLibrarySeed,
  type CatalogSeedName,
} from "./seed";
export { CatalogConfigProject } from "./workspace-config";
