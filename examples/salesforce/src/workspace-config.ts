import { defineProviderProject } from "@schematics/provider/cli";
import { salesforceProvider } from "./provider";

export const SalesforceConfigProject = defineProviderProject(salesforceProvider, {
  id: "salesforce-yaml",
});
