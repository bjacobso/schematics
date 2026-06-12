import { defineProviderProject } from "@schematics/provider/cli";
import { workatoProvider } from "./provider";

export const WorkatoConfigProject = defineProviderProject(workatoProvider, { id: "workato-yaml" });
