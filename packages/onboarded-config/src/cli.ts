#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { createEmbeddedSchemaIdeCli } from "@schema-ide/cli";
import { OnboardedConfigWorkspace } from "./workspace-config";

export function createOnboardedConfigCli() {
  return createEmbeddedSchemaIdeCli({
    name: "onboarded-config",
    workspace: OnboardedConfigWorkspace,
  });
}

const entryPointUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
const isCommonJsMain =
  typeof require !== "undefined" && typeof module !== "undefined" && require.main === module;

if ((entryPointUrl && import.meta.url === entryPointUrl) || isCommonJsMain) {
  void createOnboardedConfigCli().main();
}
