import { defineProviderProject } from "@schematics/provider/cli";
import { pagerDutyProvider } from "./provider";

export const PagerDutyConfigProject = defineProviderProject(pagerDutyProvider, {
  id: "pagerduty-yaml",
});
