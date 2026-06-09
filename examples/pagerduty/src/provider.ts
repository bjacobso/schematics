import { defineProvider } from "@schematics/provider";
import { PAGERDUTY_CONNECTION_OPTIONS } from "./connection";
import { pagerDutyResources } from "./resources";
import { acmePagerDutySeed } from "./seed";

export const pagerDutyProvider = defineProvider({
  id: "pagerduty",
  projectId: "pagerduty-yaml",
  title: "PagerDuty On-Call",
  resources: pagerDutyResources,
  connection: PAGERDUTY_CONNECTION_OPTIONS,
  mockSeed: acmePagerDutySeed,
  include: ["**/*.yaml", "config.lock.json", ".env", ".env.*"],
  metadata: ["config.lock.json"],
  secret: [".env", ".env.*"],
});

export const PagerDutyFlavor = pagerDutyProvider.flavor;
export const PagerDutyConfigDeploy = pagerDutyProvider.deploy;
export const makePagerDutyDeployService = pagerDutyProvider.makeDeployService;
export const makeMockPagerDutyTransport = pagerDutyProvider.mock;
