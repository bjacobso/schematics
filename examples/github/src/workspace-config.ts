import { defineProviderProject } from "@schematics/provider/cli";
import { githubProvider } from "./provider";

/** The schematics project definition consumed by the IDE CLI + SEA binary build. */
export const GitHubConfigProject = defineProviderProject(githubProvider, { id: "github-yaml" });
