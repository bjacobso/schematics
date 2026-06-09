#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { createProviderCli } from "@schematics/provider/cli";
import { toyProvider } from "./provider";

export const toyCli = createProviderCli(toyProvider, {
  name: "toy-config",
  projectId: "toy-yaml",
});

const entryPointUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
const isCommonJsMain =
  typeof require !== "undefined" && typeof module !== "undefined" && require.main === module;

if ((entryPointUrl && import.meta.url === entryPointUrl) || isCommonJsMain) {
  void toyCli.main();
}
