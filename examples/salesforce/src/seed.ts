import type {
  ObjectConfig,
  OrgConfig,
  ProfileConfig,
  RoleConfig,
  UserConfig,
  ValueSetConfig,
} from "./schema";

export interface SalesforceSeed extends Readonly<Record<string, readonly unknown[]>> {
  readonly org: readonly OrgConfig[];
  readonly valueSets: readonly ValueSetConfig[];
  readonly objects: readonly ObjectConfig[];
  readonly roles: readonly RoleConfig[];
  readonly profiles: readonly ProfileConfig[];
  readonly users: readonly UserConfig[];
}

export const acmeSalesforceSeed: SalesforceSeed = {
  org: [{ id: "acme", name: "Acme Corp", edition: "enterprise" }],
  valueSets: [
    { id: "industry", label: "Industry", values: ["Technology", "Finance", "Healthcare"] },
    { id: "lead-source", label: "Lead Source", values: ["Web", "Referral", "Partner"] },
  ],
  objects: [
    {
      id: "Account",
      label: "Account",
      fields: [
        { apiName: "Industry", label: "Industry", type: "picklist", valueSet: "industry" },
        { apiName: "AnnualRevenue", label: "Annual Revenue", type: "number" },
      ],
      validationRules: [
        {
          name: "RevenueNonNegative",
          field: "AnnualRevenue",
          errorMessage: "Annual revenue cannot be negative.",
        },
      ],
    },
    {
      id: "Opportunity",
      label: "Opportunity",
      fields: [
        { apiName: "LeadSource", label: "Lead Source", type: "picklist", valueSet: "lead-source" },
        { apiName: "AccountId", label: "Account", type: "lookup", lookupTo: "Account" },
      ],
    },
  ],
  roles: [
    { id: "ceo", name: "CEO" },
    { id: "vp-sales", name: "VP of Sales", parentRoleId: "ceo" },
    { id: "ae", name: "Account Executive", parentRoleId: "vp-sales" },
  ],
  profiles: [
    { id: "system-admin", name: "System Administrator", objectAccess: ["Account", "Opportunity"] },
    { id: "sales-user", name: "Sales User", objectAccess: ["Account", "Opportunity"] },
  ],
  users: [
    { id: "alice", email: "alice@acme.example", profileId: "system-admin", roleId: "ceo" },
    { id: "bob", email: "bob@acme.example", profileId: "sales-user", roleId: "ae" },
  ],
};

export const salesforceSeeds = {
  acme: acmeSalesforceSeed,
} as const satisfies Record<string, SalesforceSeed>;
export type SalesforceSeedName = keyof typeof salesforceSeeds;
