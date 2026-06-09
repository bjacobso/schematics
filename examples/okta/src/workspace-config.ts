import { defineProviderProject } from "@schematics/provider/cli";
import { oktaProvider } from "./provider";

export const OktaConfigProject = defineProviderProject(oktaProvider, { id: "okta-yaml" });
