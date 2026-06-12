import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "@schematics/core";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  ConnectionConfigSchema, FolderConfigSchema, LookupTableConfigSchema,
  PropertiesConfigSchema, RecipeConfigSchema, validateWorkatoWorkspaceValue,
} from "../src/index";

const root = join(dirname(fileURLToPath(import.meta.url)), "../projects/acme-revops/files");
const decode = (schema: Schema.Schema<any>, path: string) =>
  Schema.decodeUnknownSync(parseYaml(schema))(readFileSync(path, "utf8"));
const load = (dir: string, schema: Schema.Schema<any>) =>
  readdirSync(join(root, dir)).map((f) => decode(schema, join(root, dir, f)));

describe("example yaml files", () => {
  it("decode and cross-validate cleanly", () => {
    const workspace = {
      folders: load("folders", FolderConfigSchema),
      connections: load("connections", ConnectionConfigSchema),
      lookupTables: load("lookup-tables", LookupTableConfigSchema),
      properties: decode(PropertiesConfigSchema, join(root, "properties.yaml")),
      recipes: load("recipes", RecipeConfigSchema),
    };
    expect(validateWorkatoWorkspaceValue(workspace as any)).toEqual([]);
  });
});
