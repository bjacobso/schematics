import { defineResource } from "@schematics/provider";
import {
  ObjectConfigSchema,
  OBJECT_KIND,
  OrgConfigSchema,
  ORG_KIND,
  ProfileConfigSchema,
  PROFILE_KIND,
  RoleConfigSchema,
  ROLE_KIND,
  UserConfigSchema,
  USER_KIND,
  ValueSetConfigSchema,
  VALUE_SET_KIND,
} from "./schema";

export const salesforceResources = [
  defineResource<typeof OrgConfigSchema.Type>({
    kind: ORG_KIND,
    schemaId: "Org",
    schema: OrgConfigSchema,
    single: true,
    route: "org.yaml",
    writeOps: "read-only",
    description: "The Salesforce org container",
  }),
  defineResource<typeof ValueSetConfigSchema.Type>({
    kind: VALUE_SET_KIND,
    schemaId: "ValueSets",
    schema: ValueSetConfigSchema,
    route: "value-sets/*.yaml",
    description: "Global picklist value sets",
  }),
  defineResource<typeof ObjectConfigSchema.Type>({
    kind: OBJECT_KIND,
    schemaId: "Objects",
    schema: ObjectConfigSchema,
    slug: (config) => config.id.toLowerCase(),
    applySlugToConfig: false,
    description: "Standard and custom objects with fields and validation rules",
  }),
  defineResource<typeof RoleConfigSchema.Type>({
    kind: ROLE_KIND,
    schemaId: "Roles",
    schema: RoleConfigSchema,
    description: "The role hierarchy",
  }),
  defineResource<typeof ProfileConfigSchema.Type>({
    kind: PROFILE_KIND,
    schemaId: "Profiles",
    schema: ProfileConfigSchema,
    description: "Permission profiles",
  }),
  defineResource<typeof UserConfigSchema.Type>({
    kind: USER_KIND,
    schemaId: "Users",
    schema: UserConfigSchema,
    description: "Users assigned to profiles and roles",
  }),
];
