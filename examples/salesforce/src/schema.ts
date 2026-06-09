import { Relation } from "@schematics/algebra";
import { Schema } from "effect";

export const ORG_KIND = "org";
export const OBJECT_KIND = "object";
export const FIELD_KIND = "field";
export const VALUE_SET_KIND = "valueSet";
export const ROLE_KIND = "role";
export const PROFILE_KIND = "profile";
export const USER_KIND = "user";

export const OrgConfigSchema = Schema.Struct({
  id: Relation.id(ORG_KIND, { display: "name" }),
  name: Schema.String,
  edition: Schema.optional(Schema.Literals(["developer", "enterprise", "unlimited"])),
});
export type OrgConfig = typeof OrgConfigSchema.Type;

export const ValueSetConfigSchema = Schema.Struct({
  id: Relation.id(VALUE_SET_KIND, { display: "label" }),
  label: Schema.String,
  values: Schema.Array(Schema.String),
});
export type ValueSetConfig = typeof ValueSetConfigSchema.Type;

export const RoleConfigSchema = Schema.Struct({
  id: Relation.id(ROLE_KIND, { display: "name" }),
  name: Schema.String,
  parentRoleId: Schema.optional(Relation.ref(ROLE_KIND)),
});
export type RoleConfig = typeof RoleConfigSchema.Type;

export const FieldConfigSchema = Schema.Struct({
  apiName: Relation.id(FIELD_KIND, { scope: Relation.parent(OBJECT_KIND), display: "label" }),
  label: Schema.String,
  type: Schema.Literals(["text", "number", "checkbox", "picklist", "lookup"]),
  valueSet: Schema.optional(Relation.ref(VALUE_SET_KIND)),
  lookupTo: Schema.optional(Relation.ref(OBJECT_KIND)),
});
export type FieldConfig = typeof FieldConfigSchema.Type;

export const ValidationRuleConfigSchema = Schema.Struct({
  name: Schema.String,
  field: Relation.ref(FIELD_KIND, { scopedBy: ["..", "id"] }),
  errorMessage: Schema.String,
});
export type ValidationRuleConfig = typeof ValidationRuleConfigSchema.Type;

export const ObjectConfigSchema = Schema.Struct({
  id: Relation.id(OBJECT_KIND, { display: "label" }),
  label: Schema.String,
  fields: Schema.Array(FieldConfigSchema),
  validationRules: Schema.optional(Schema.Array(ValidationRuleConfigSchema)),
});
export type ObjectConfig = typeof ObjectConfigSchema.Type;

export const ProfileConfigSchema = Schema.Struct({
  id: Relation.id(PROFILE_KIND, { display: "name" }),
  name: Schema.String,
  objectAccess: Relation.refs(OBJECT_KIND, { edge: "grants" }),
});
export type ProfileConfig = typeof ProfileConfigSchema.Type;

export const UserConfigSchema = Schema.Struct({
  id: Relation.id(USER_KIND, { display: "email" }),
  email: Schema.String,
  profileId: Relation.ref(PROFILE_KIND),
  roleId: Schema.optional(Relation.ref(ROLE_KIND)),
});
export type UserConfig = typeof UserConfigSchema.Type;

export const SalesforceWorkspaceSchema = Schema.Struct({
  org: Schema.NullOr(OrgConfigSchema),
  valueSets: Schema.Array(ValueSetConfigSchema),
  objects: Schema.Array(ObjectConfigSchema),
  roles: Schema.Array(RoleConfigSchema),
  profiles: Schema.Array(ProfileConfigSchema),
  users: Schema.Array(UserConfigSchema),
});
export type SalesforceWorkspaceValue = typeof SalesforceWorkspaceSchema.Type;
