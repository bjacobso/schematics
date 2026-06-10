import { defineProvider } from "@schematics/provider";
import { TOY_CONNECTION_OPTIONS } from "./connection";
import { toyTextCardIngestor } from "./ingestor";
import { toyResources } from "./resources";
import { validToySeed } from "./seed";

export const toyProvider = defineProvider({
  id: "toy",
  projectId: "toy-yaml",
  title: "Toy",
  resources: toyResources,
  connection: TOY_CONNECTION_OPTIONS,
  mockSeed: validToySeed,
  include: ["**/*.yaml", "config.lock.json", ".env", ".env.*"],
  metadata: ["config.lock.json"],
  secret: [".env", ".env.*"],
  ingestors: [toyTextCardIngestor],
});

export const ToyFlavor = toyProvider.flavor;
export const ToyConfigDeploy = toyProvider.deploy;
export const makeToyDeployService = toyProvider.makeDeployService;
export const makeMockToyTransport = toyProvider.mock;
