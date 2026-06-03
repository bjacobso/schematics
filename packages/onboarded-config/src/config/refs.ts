/** Resolves cross-entity references between config slugs and remote ids. */
export interface RefResolver {
  /** slug → remoteId (config → DTO, on write). Null if not yet known. */
  readonly toRemoteId: (kind: string, key: string) => string | null;
  /** remoteId → slug (DTO → config, on read). Falls back to the remoteId if unknown. */
  readonly toKey: (kind: string, remoteId: string) => string | null;
}

export const FORM_KIND = "OnboardedForm";
export const POLICY_KIND = "OnboardedPolicy";
export const AUTOMATION_KIND = "OnboardedAutomation";
export const CUSTOM_PROPERTY_KIND = "OnboardedCustomProperty";
export const ACCOUNT_KIND = "OnboardedAccount";

/** A resolver that knows nothing — used for entities without cross-references. */
export const identityResolver: RefResolver = {
  toRemoteId: () => null,
  toKey: () => null,
};
