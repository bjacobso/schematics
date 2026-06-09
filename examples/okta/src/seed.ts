import type {
  AppConfig,
  AuthServerConfig,
  GroupConfig,
  PolicyConfig,
  UserConfig,
} from "./schema";

export interface OktaSeed extends Readonly<Record<string, readonly unknown[]>> {
  readonly authServers: readonly AuthServerConfig[];
  readonly apps: readonly AppConfig[];
  readonly groups: readonly GroupConfig[];
  readonly users: readonly UserConfig[];
  readonly policies: readonly PolicyConfig[];
}

export const acmeOktaSeed: OktaSeed = {
  authServers: [
    {
      id: "default",
      name: "Default",
      audience: "api://default",
      scopes: [
        { value: "read:profile", description: "Read the user profile" },
        { value: "write:profile", description: "Update the user profile" },
      ],
    },
  ],
  apps: [
    { id: "internal-api", label: "Internal API", signOnMode: "oidc", authServerId: "default" },
    { id: "salesforce", label: "Salesforce", signOnMode: "saml" },
  ],
  groups: [
    { id: "engineering", name: "Engineering", apps: ["internal-api"] },
    { id: "everyone", name: "All Employees", apps: ["salesforce"] },
  ],
  users: [
    { id: "alice", email: "alice@acme.example", groups: ["engineering", "everyone"] },
    { id: "bob", email: "bob@acme.example", groups: ["everyone"] },
  ],
  policies: [
    { id: "eng-signon", name: "Engineering Sign-On", type: "sign-on", groups: ["engineering"] },
    { id: "require-mfa", name: "Require MFA", type: "mfa-enroll", groups: ["everyone"] },
  ],
};

export const oktaSeeds = { acme: acmeOktaSeed } as const satisfies Record<string, OktaSeed>;
export type OktaSeedName = keyof typeof oktaSeeds;
