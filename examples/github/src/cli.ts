#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { createProviderCli } from "@schematics/provider/cli";
import { githubProvider } from "./provider";

export const githubCli = createProviderCli(githubProvider, {
  name: "github-config",
  projectId: "github-yaml",
});

const entryPointUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
const isCommonJsMain =
  typeof require !== "undefined" && typeof module !== "undefined" && require.main === module;

if ((entryPointUrl && import.meta.url === entryPointUrl) || isCommonJsMain) {
  void githubCli.main();
}
