import { Relation } from "@schematics/algebra";
import { Schema } from "effect";

export const AUTH_SERVER_KIND = "authServer";
export const SCOPE_KIND = "scope";
export const APP_KIND = "app";
export const GROUP_KIND = "group";
export const USER_KIND = "user";
export const POLICY_KIND = "policy";

export const ScopeConfigSchema = Relation.derivedId(
  Schema.Struct({
    value: Schema.String,
    description: Schema.optional(Schema.String),
  }),
  SCOPE_KIND,
  { id: "value", display: "value" },
);
export type ScopeConfig = typeof ScopeConfigSchema.Type;

export const AuthServerConfigSchema = Schema.Struct({
  id: Relation.id(AUTH_SERVER_KIND, { display: "name" }),
  name: Schema.String,
  audience: Schema.String,
  scopes: Schema.Array(ScopeConfigSchema),
});
export type AuthServerConfig = typeof AuthServerConfigSchema.Type;

export const AppConfigSchema = Schema.Struct({
  id: Relation.id(APP_KIND, { display: "label" }),
  label: Schema.String,
  signOnMode: Schema.Literals(["oidc", "saml", "bookmark"]),
  authServerId: Schema.optional(Relation.ref(AUTH_SERVER_KIND)),
});
export type AppConfig = typeof AppConfigSchema.Type;

export const GroupConfigSchema = Schema.Struct({
  id: Relation.id(GROUP_KIND, { display: "name" }),
  name: Schema.String,
  apps: Relation.refs(APP_KIND, { edge: "assigns" }),
});
export type GroupConfig = typeof GroupConfigSchema.Type;

export const UserConfigSchema = Schema.Struct({
  id: Relation.id(USER_KIND, { display: "email" }),
  email: Schema.String,
  groups: Relation.refs(GROUP_KIND, { edge: "memberOf" }),
});
export type UserConfig = typeof UserConfigSchema.Type;

export const PolicyConfigSchema = Schema.Struct({
  id: Relation.id(POLICY_KIND, { display: "name" }),
  name: Schema.String,
  type: Schema.Literals(["sign-on", "password", "mfa-enroll"]),
  groups: Relation.refs(GROUP_KIND, { edge: "appliesTo" }),
});
export type PolicyConfig = typeof PolicyConfigSchema.Type;

export const OktaWorkspaceSchema = Schema.Struct({
  authServers: Schema.Array(AuthServerConfigSchema),
  apps: Schema.Array(AppConfigSchema),
  groups: Schema.Array(GroupConfigSchema),
  users: Schema.Array(UserConfigSchema),
  policies: Schema.Array(PolicyConfigSchema),
});
export type OktaWorkspaceValue = typeof OktaWorkspaceSchema.Type;
