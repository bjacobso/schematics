#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { createEmbeddedSchematicsCli } from "@schematics/cli";
import { OnboardedConfigProject } from "./workspace-config";

export function createOnboardedConfigCli() {
  return createEmbeddedSchematicsCli({
    name: "onboarded-config",
    project: OnboardedConfigProject,
  });
}

const entryPointUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
const isCommonJsMain =
  typeof require !== "undefined" && typeof module !== "undefined" && require.main === module;

if ((entryPointUrl && import.meta.url === entryPointUrl) || isCommonJsMain) {
  void createOnboardedConfigCli().main();
}
