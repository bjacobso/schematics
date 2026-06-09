import { defineProvider } from "@schematics/provider";
import { OKTA_CONNECTION_OPTIONS } from "./connection";
import { oktaResources } from "./resources";
import { acmeOktaSeed } from "./seed";

export const oktaProvider = defineProvider({
  id: "okta",
  projectId: "okta-yaml",
  title: "Okta Identity",
  resources: oktaResources,
  connection: OKTA_CONNECTION_OPTIONS,
  mockSeed: acmeOktaSeed,
  include: ["**/*.yaml", "config.lock.json", ".env", ".env.*"],
  metadata: ["config.lock.json"],
  secret: [".env", ".env.*"],
});

export const OktaFlavor = oktaProvider.flavor;
export const OktaConfigDeploy = oktaProvider.deploy;
export const makeOktaDeployService = oktaProvider.makeDeployService;
export const makeMockOktaTransport = oktaProvider.mock;
