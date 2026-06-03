#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { createSchematicsCli } from "./index";

const entryPointUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (entryPointUrl && import.meta.url === entryPointUrl) {
  await createSchematicsCli().main();
}
