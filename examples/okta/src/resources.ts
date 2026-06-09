import { defineResource } from "@schematics/provider";
import {
  AppConfigSchema,
  APP_KIND,
  AuthServerConfigSchema,
  AUTH_SERVER_KIND,
  GroupConfigSchema,
  GROUP_KIND,
  PolicyConfigSchema,
  POLICY_KIND,
  UserConfigSchema,
  USER_KIND,
} from "./schema";

export const oktaResources = [
  defineResource<typeof AuthServerConfigSchema.Type>({
    kind: AUTH_SERVER_KIND,
    schemaId: "AuthServers",
    schema: AuthServerConfigSchema,
    route: "auth-servers/*.yaml",
    description: "Authorization servers with derived-id scopes",
  }),
  defineResource<typeof AppConfigSchema.Type>({
    kind: APP_KIND,
    schemaId: "Apps",
    schema: AppConfigSchema,
    description: "Applications, optionally bound to an auth server",
  }),
  defineResource<typeof GroupConfigSchema.Type>({
    kind: GROUP_KIND,
    schemaId: "Groups",
    schema: GroupConfigSchema,
    description: "Groups that assign apps to members",
  }),
  defineResource<typeof UserConfigSchema.Type>({
    kind: USER_KIND,
    schemaId: "Users",
    schema: UserConfigSchema,
    description: "Users and their group memberships",
  }),
  defineResource<typeof PolicyConfigSchema.Type>({
    kind: POLICY_KIND,
    schemaId: "Policies",
    schema: PolicyConfigSchema,
    description: "Policies applied to groups",
  }),
];
