import { Relation, validateRelations, type RelationDiagnostic } from "@schematics/algebra";
import type { AnyArtifactType } from "@schematics/artifacts";
import {
  ArtifactProject,
  Project,
  SchematicsProjectFileArtifact,
  type SchematicsDiagnostic,
} from "@schematics/core";
import { Schema } from "effect";

/**
 * Okta-style identity configuration, modeled as config-as-code with
 * `@schematics/algebra`.
 *
 * Identity config is a dense *assignment graph* — who is in which group, which
 * groups get which apps, which policies apply to which groups — so this example
 * leans on `refs` + typed edges. Authorization servers carry derived-id scopes
 * to round out the tour.
 *
 * | Algebra ability         | Where it shows up                                     |
 * | ----------------------- | ----------------------------------------------------- |
 * | `id` + `display`        | every entity (`app`, `group`, `user`, `policy`, …)    |
 * | `ref` (single, id)      | `app.authServerId → authServer`                       |
 * | `refs` (array) + `edge` | `group.apps` (`assigns`), `user.groups` (`memberOf`)  |
 * | `derivedId`             | `scope` id derived from its `value` field             |
 */

export const AUTH_SERVER_KIND = "authServer";
export const SCOPE_KIND = "scope";
export const APP_KIND = "app";
export const GROUP_KIND = "group";
export const USER_KIND = "user";
export const POLICY_KIND = "policy";

/**
 * An OAuth scope on an authorization server. Its id is *derived* from the
 * `value` field rather than a separate id property.
 */
export const ScopeConfigSchema = Relation.derivedId(
  Schema.Struct({
    value: Schema.String,
    description: Schema.optional(Schema.String),
  }),
  SCOPE_KIND,
  { id: "value", display: "value" },
);
export type ScopeConfig = typeof ScopeConfigSchema.Type;

/** An authorization server, owning its scopes. */
export const AuthServerConfigSchema = Schema.Struct({
  id: Relation.id(AUTH_SERVER_KIND, { display: "name" }),
  name: Schema.String,
  audience: Schema.String,
  scopes: Schema.Array(ScopeConfigSchema),
});
export type AuthServerConfig = typeof AuthServerConfigSchema.Type;

/** An application; OIDC apps point at an authorization server via a single `ref`. */
export const AppConfigSchema = Schema.Struct({
  id: Relation.id(APP_KIND, { display: "label" }),
  label: Schema.String,
  signOnMode: Schema.Literals(["oidc", "saml", "bookmark"]),
  authServerId: Schema.optional(Relation.ref(AUTH_SERVER_KIND)),
});
export type AppConfig = typeof AppConfigSchema.Type;

/** A group: the apps assigned to its members (`refs` + edge). */
export const GroupConfigSchema = Schema.Struct({
  id: Relation.id(GROUP_KIND, { display: "name" }),
  name: Schema.String,
  apps: Relation.refs(APP_KIND, { edge: "assigns" }),
});
export type GroupConfig = typeof GroupConfigSchema.Type;

/** A user and the groups they belong to (`refs` + edge). */
export const UserConfigSchema = Schema.Struct({
  id: Relation.id(USER_KIND, { display: "email" }),
  email: Schema.String,
  groups: Relation.refs(GROUP_KIND, { edge: "memberOf" }),
});
export type UserConfig = typeof UserConfigSchema.Type;

/** A policy and the groups it applies to (`refs` + edge). */
export const PolicyConfigSchema = Schema.Struct({
  id: Relation.id(POLICY_KIND, { display: "name" }),
  name: Schema.String,
  type: Schema.Literals(["sign-on", "password", "mfa-enroll"]),
  groups: Relation.refs(GROUP_KIND, { edge: "appliesTo" }),
});
export type PolicyConfig = typeof PolicyConfigSchema.Type;

/** The whole identity value the relation graph is built from. */
export const OktaWorkspaceSchema = Schema.Struct({
  authServers: Schema.Array(AuthServerConfigSchema),
  apps: Schema.Array(AppConfigSchema),
  groups: Schema.Array(GroupConfigSchema),
  users: Schema.Array(UserConfigSchema),
  policies: Schema.Array(PolicyConfigSchema),
});
export type OktaWorkspaceValue = typeof OktaWorkspaceSchema.Type;

// The framework's project-file artifact carries the view handlers the
// standalone `web`/RPC IDE requests; a bare ArtifactType leaves it on "Loading".
const projectFileArtifact = SchematicsProjectFileArtifact as unknown as AnyArtifactType;

export const OktaArtifactProject = ArtifactProject.make("okta-yaml")
  .files("auth-servers/*.yaml", {
    id: "AuthServers",
    type: projectFileArtifact,
    schema: AuthServerConfigSchema,
    metadata: {
      attributes: {
        schemaId: "AuthServers",
        workspaceField: "authServers",
        values: true,
        format: "yaml",
        description: "Authorization servers with derived-id scopes",
      },
    },
  })
  .files("apps/*.yaml", {
    id: "Apps",
    type: projectFileArtifact,
    schema: AppConfigSchema,
    metadata: {
      attributes: {
        schemaId: "Apps",
        workspaceField: "apps",
        values: true,
        format: "yaml",
        description: "Applications, optionally bound to an auth server",
      },
    },
  })
  .files("groups/*.yaml", {
    id: "Groups",
    type: projectFileArtifact,
    schema: GroupConfigSchema,
    metadata: {
      attributes: {
        schemaId: "Groups",
        workspaceField: "groups",
        values: true,
        format: "yaml",
        description: "Groups that assign apps to members",
      },
    },
  })
  .files("users/*.yaml", {
    id: "Users",
    type: projectFileArtifact,
    schema: UserConfigSchema,
    metadata: {
      attributes: {
        schemaId: "Users",
        workspaceField: "users",
        values: true,
        format: "yaml",
        description: "Users and their group memberships",
      },
    },
  })
  .files("policies/*.yaml", {
    id: "Policies",
    type: projectFileArtifact,
    schema: PolicyConfigSchema,
    metadata: {
      attributes: {
        schemaId: "Policies",
        workspaceField: "policies",
        values: true,
        format: "yaml",
        description: "Policies applied to groups",
      },
    },
  });

const DOCUMENT_FIELDS: Record<string, string | undefined> = {
  [AUTH_SERVER_KIND]: "authServers",
  [APP_KIND]: "apps",
  [GROUP_KIND]: "groups",
  [USER_KIND]: "users",
  [POLICY_KIND]: "policies",
};

function friendlyMessage(diagnostic: RelationDiagnostic): string {
  const relation = diagnostic.relation;
  if (diagnostic.code === "unresolved-ref" && "target" in relation) {
    return `Unknown ${relation.target}: ${relation.id}`;
  }
  if (diagnostic.code === "duplicate-id" && "type" in relation) {
    return `Duplicate ${relation.type} id: ${relation.id}`;
  }
  return diagnostic.message;
}

function documentPathFor(diagnostic: RelationDiagnostic): string {
  const relation = diagnostic.relation;
  const kind = "target" in relation ? relation.target : relation.type;
  const field = DOCUMENT_FIELDS[kind];
  if (field && "id" in relation) return `${field}.${relation.id}`;
  return diagnostic.path.length > 0 ? Relation.key(diagnostic.path).join(".") : "groups";
}

/** Cross-file workspace diagnostics: duplicate ids and unresolved references. */
export function validateOktaWorkspaceValue(
  workspace: OktaWorkspaceValue,
): readonly SchematicsDiagnostic[] {
  return validateRelations(OktaWorkspaceSchema, workspace).map((diagnostic) => ({
    path: diagnostic.path.length > 0 ? Relation.key(diagnostic.path).join(".") : null,
    documentPath: documentPathFor(diagnostic),
    severity: diagnostic.severity === "warning" ? "warning" : "error",
    source: "cross-file",
    message: friendlyMessage(diagnostic),
  }));
}

export const OktaProjectBaseSchema = Project.fromArtifactProject(OktaArtifactProject);

export const OktaProjectSchema = OktaProjectBaseSchema.pipe(
  Project.validate<OktaWorkspaceValue>("okta identity references resolve", (workspace, issue) => {
    for (const diagnostic of validateOktaWorkspaceValue(workspace)) {
      issue.at(diagnostic.documentPath ?? "groups", diagnostic.message, diagnostic.path);
    }
  }),
);
