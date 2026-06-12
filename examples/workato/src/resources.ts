import { defineResource } from "@schematics/provider";
import {
  ConnectionConfigSchema,
  CONNECTION_KIND,
  FolderConfigSchema,
  FOLDER_KIND,
  LookupTableConfigSchema,
  LOOKUP_TABLE_KIND,
  PropertiesConfigSchema,
  PROPERTIES_KIND,
  RecipeConfigSchema,
  RECIPE_KIND,
} from "./schema";

export const workatoResources = [
  defineResource<typeof FolderConfigSchema.Type>({
    kind: FOLDER_KIND,
    schemaId: "Folders",
    schema: FolderConfigSchema,
    description: "Folders organizing recipes and connections, nestable via parentId",
  }),
  defineResource<typeof ConnectionConfigSchema.Type>({
    kind: CONNECTION_KIND,
    schemaId: "Connections",
    schema: ConnectionConfigSchema,
    description: "Adapter connections recipes authenticate through",
  }),
  defineResource<typeof LookupTableConfigSchema.Type>({
    kind: LOOKUP_TABLE_KIND,
    schemaId: "LookupTables",
    schema: LookupTableConfigSchema,
    route: "lookup-tables/*.yaml",
    description: "Lookup tables recipes match rows against at runtime",
  }),
  defineResource<typeof PropertiesConfigSchema.Type>({
    kind: PROPERTIES_KIND,
    schemaId: "Properties",
    schema: PropertiesConfigSchema,
    single: true,
    description: "Environment-wide project properties recipes interpolate",
  }),
  defineResource<typeof RecipeConfigSchema.Type>({
    kind: RECIPE_KIND,
    schemaId: "Recipes",
    schema: RecipeConfigSchema,
    description:
      "Recipes: a trigger plus a recursive step tree of actions, branches, loops, error monitors, and recipe-function calls",
  }),
];
