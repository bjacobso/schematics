import { defineProvider } from "@schematics/provider";
import { SALESFORCE_CONNECTION_OPTIONS } from "./connection";
import { salesforceResources } from "./resources";
import { acmeSalesforceSeed } from "./seed";

export const salesforceProvider = defineProvider({
  id: "salesforce",
  projectId: "salesforce-yaml",
  title: "Salesforce Org",
  resources: salesforceResources,
  connection: SALESFORCE_CONNECTION_OPTIONS,
  mockSeed: acmeSalesforceSeed,
  include: ["**/*.yaml", "config.lock.json", ".env", ".env.*"],
  metadata: ["config.lock.json"],
  secret: [".env", ".env.*"],
});

export const SalesforceFlavor = salesforceProvider.flavor;
export const SalesforceConfigDeploy = salesforceProvider.deploy;
export const makeSalesforceDeployService = salesforceProvider.makeDeployService;
export const makeMockSalesforceTransport = salesforceProvider.mock;
