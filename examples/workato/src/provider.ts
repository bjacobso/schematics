import { defineProvider } from "@schematics/provider";
import { WORKATO_CONNECTION_OPTIONS } from "./connection";
import { workatoResources } from "./resources";
import { acmeWorkatoSeed } from "./seed";

export const workatoProvider = defineProvider({
  id: "workato",
  projectId: "workato-yaml",
  title: "Workato Automation",
  resources: workatoResources,
  connection: WORKATO_CONNECTION_OPTIONS,
  mockSeed: acmeWorkatoSeed,
  include: ["**/*.yaml", "config.lock.json", ".env", ".env.*"],
  metadata: ["config.lock.json"],
  secret: [".env", ".env.*"],
});

export const WorkatoFlavor = workatoProvider.flavor;
export const WorkatoConfigDeploy = workatoProvider.deploy;
export const makeWorkatoDeployService = workatoProvider.makeDeployService;
export const makeMockWorkatoTransport = workatoProvider.mock;
