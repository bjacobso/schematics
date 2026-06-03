// Config-file schemas (slug-keyed, hand-editable) + DTO⇄config mappers
export {
  ACCOUNT_KIND,
  AUTOMATION_KIND,
  CUSTOM_PROPERTY_KIND,
  FORM_KIND,
  POLICY_KIND,
  OnboardedAccountConfigSchema,
  OnboardedAutomationConfigSchema,
  OnboardedCustomPropertyConfigSchema,
  OnboardedFormConfigSchema,
  OnboardedPolicyConfigSchema,
  accountConfigFromDto,
  automationConfigFromDto,
  automationImportDtoFromConfig,
  customPropertyConfigFromDto,
  customPropertyDtoFromConfig,
  formConfigFromDto,
  formCreateDtoFromConfig,
  formUpdateDtoFromConfig,
  identityResolver,
  policyConfigFromDto,
  policyCreateDtoFromConfig,
  policyUpdateDtoFromConfig,
  type OnboardedAccountConfig,
  type OnboardedAutomationConfig,
  type OnboardedCustomPropertyConfig,
  type OnboardedFormConfig,
  type OnboardedPolicyConfig,
  type RefResolver,
} from "./config";

// Faithful domain DTO mirrors (the API "wire" shapes)
export * as Domain from "./domain";

// config-deploy wiring + mock OnboardedApi
export {
  ONBOARDED_MANAGED_TAG,
  makeOnboardedConfigDeploy,
  onboardedYamlCodec,
  slugify,
  type OnboardedConfigDeployOptions,
} from "./deploy";
export {
  makeMockOnboardedApi,
  OnboardedApiError,
  seedOnboardedData,
  type MockOnboardedApiOptions,
  type OnboardedApi,
  type OnboardedApiCall,
  type OnboardedSeed,
} from "./mock";

// Artifact project (IDE schema-routed validation of the on-disk example)
export {
  OnboardedArtifactProject,
  OnboardedArtifactProjectConfigDefinition,
  OnboardedArtifactProjectConfigSchema,
  OnboardedArtifactProjectEnvironment,
  OnboardedArtifactProjectRouteSchema,
  createOnboardedArtifactProject,
  parseOnboardedArtifactProjectConfig,
  serializeOnboardedArtifactProjectConfig,
  type OnboardedArtifactProjectConfig,
  type OnboardedArtifactProjectRoute,
} from "./artifacts";
export {
  createOnboardedArtifactRuntime,
  createOnboardedArtifactRuntimeFromProjectConfig,
  type CreateOnboardedArtifactRuntimeOptions,
  type OnboardedArtifactRuntime,
} from "./runtime";
export {
  OnboardedRelationWorkspaceSchema,
  createOnboardedRelationWorkspace,
  validateOnboardedRelations,
  type OnboardedRelationWorkspace,
} from "./relations";
export {
  OnboardedRuleSchema,
  RuleOperatorSchema,
  type Rule,
  type RuleAll,
  type RuleAny,
  type RuleCondition,
} from "./rules";
export { allowedTaskPaths, buildAttributePathSet, validateRuleFacts } from "./validation";
export {
  OnboardedAccountWorkspaceBaseSchema,
  OnboardedAccountWorkspaceSchema,
  validateOnboardedAccountWorkspaceValue,
  type AccountWorkspaceValue,
} from "./workspace";
