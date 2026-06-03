export {
  ACCOUNT_KIND,
  AUTOMATION_KIND,
  CUSTOM_PROPERTY_KIND,
  FORM_KIND,
  POLICY_KIND,
  identityResolver,
  type RefResolver,
} from "./refs";
export { OnboardedAccountConfigSchema, accountConfigFromDto, type OnboardedAccountConfig } from "./account";
export {
  OnboardedCustomPropertyConfigSchema,
  customPropertyConfigFromDto,
  customPropertyDtoFromConfig,
  type OnboardedCustomPropertyConfig,
} from "./custom-properties";
export {
  OnboardedFormConfigSchema,
  formConfigFromDto,
  formCreateDtoFromConfig,
  formUpdateDtoFromConfig,
  type OnboardedFormConfig,
} from "./forms";
export {
  OnboardedPolicyConfigSchema,
  policyConfigFromDto,
  policyCreateDtoFromConfig,
  policyUpdateDtoFromConfig,
  type OnboardedPolicyConfig,
} from "./policies";
export {
  OnboardedAutomationConfigSchema,
  automationConfigFromDto,
  automationImportDtoFromConfig,
  type OnboardedAutomationConfig,
} from "./automations";
