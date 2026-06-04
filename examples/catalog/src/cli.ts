#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { createEmbeddedSchematicsCli } from "@schematics/cli";
import { CatalogConfigProject } from "./workspace-config";

export function createCatalogConfigCli() {
  return createEmbeddedSchematicsCli({
    name: "catalog-config",
    project: CatalogConfigProject,
  });
}

const entryPointUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
const isCommonJsMain =
  typeof require !== "undefined" && typeof module !== "undefined" && require.main === module;

if ((entryPointUrl && import.meta.url === entryPointUrl) || isCommonJsMain) {
  void createCatalogConfigCli().main();
}
