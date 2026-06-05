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
 * Salesforce org metadata, modeled as config-as-code with `@schematics/algebra`.
 *
 * The point of the demo: the things Salesforce admins normally click together in
 * Setup — objects, fields, picklists, roles, profiles, users, validation rules —
 * become schema-routed YAML files whose cross-references the runtime checks
 * before any change lands. It leans on the algebra features that map cleanly to
 * the metadata model:
 *
 * | Algebra ability         | Where it shows up                                   |
 * | ----------------------- | --------------------------------------------------- |
 * | `id` + `display`        | every entity (`org`, `object`, `profile`, …)        |
 * | `parent` scope          | `field.apiName` scoped to its enclosing `object`    |
 * | `ref` (single, id)      | `user.profileId → profile`, `field.lookupTo → object` |
 * | `refs` (array) + `edge` | `profile.objectAccess → object`, edge `grants`      |
 * | self-referential `ref`  | `role.parentRoleId → role` (the role hierarchy)     |
 * | `scopedBy` (on a ref)   | `validationRule.field → field`, scoped by object id |
 */

export const ORG_KIND = "org";
export const OBJECT_KIND = "object";
export const FIELD_KIND = "field";
export const VALUE_SET_KIND = "valueSet";
export const ROLE_KIND = "role";
export const PROFILE_KIND = "profile";
export const USER_KIND = "user";

// ── leaf entities ─────────────────────────────────────────────────────────────

/** The single org container; one per workspace, like an account root. */
export const OrgConfigSchema = Schema.Struct({
  id: Relation.id(ORG_KIND, { display: "name" }),
  name: Schema.String,
  edition: Schema.optional(Schema.Literals(["developer", "enterprise", "unlimited"])),
});
export type OrgConfig = typeof OrgConfigSchema.Type;

/** A global value set (picklist) — the target of single `ref`s from fields. */
export const ValueSetConfigSchema = Schema.Struct({
  id: Relation.id(VALUE_SET_KIND, { display: "label" }),
  label: Schema.String,
  values: Schema.Array(Schema.String),
});
export type ValueSetConfig = typeof ValueSetConfigSchema.Type;

/**
 * A role in the hierarchy. `parentRoleId` is a *self-referential* single ref —
 * the role-hierarchy tree the rest of the algebra examples don't show.
 */
export const RoleConfigSchema = Schema.Struct({
  id: Relation.id(ROLE_KIND, { display: "name" }),
  name: Schema.String,
  parentRoleId: Schema.optional(Relation.ref(ROLE_KIND)),
});
export type RoleConfig = typeof RoleConfigSchema.Type;

// ── object + its nested, scoped children ──────────────────────────────────────

/**
 * A custom or standard field. Its `apiName` id is *scoped to the enclosing
 * object* via the `parent` scope builder, so `Industry` can exist on more than
 * one object. Picklist fields point at a value set and lookup fields at another
 * object, both via single `ref`s.
 */
export const FieldConfigSchema = Schema.Struct({
  apiName: Relation.id(FIELD_KIND, { scope: Relation.parent(OBJECT_KIND), display: "label" }),
  label: Schema.String,
  type: Schema.Literals(["text", "number", "checkbox", "picklist", "lookup"]),
  valueSet: Schema.optional(Relation.ref(VALUE_SET_KIND)),
  lookupTo: Schema.optional(Relation.ref(OBJECT_KIND)),
});
export type FieldConfig = typeof FieldConfigSchema.Type;

/**
 * A validation rule on the object. Its `field` reference is *scoped by the
 * object id* (`scopedBy: ["..","id"]`, walking one object up to the object), so
 * it resolves against the object-scoped field definitions above.
 */
export const ValidationRuleConfigSchema = Schema.Struct({
  name: Schema.String,
  field: Relation.ref(FIELD_KIND, { scopedBy: ["..", "id"] }),
  errorMessage: Schema.String,
});
export type ValidationRuleConfig = typeof ValidationRuleConfigSchema.Type;

/** A standard or custom object (sObject), owning its fields and validation rules. */
export const ObjectConfigSchema = Schema.Struct({
  id: Relation.id(OBJECT_KIND, { display: "label" }),
  label: Schema.String,
  fields: Schema.Array(FieldConfigSchema),
  validationRules: Schema.optional(Schema.Array(ValidationRuleConfigSchema)),
});
export type ObjectConfig = typeof ObjectConfigSchema.Type;

// ── profile + user ────────────────────────────────────────────────────────────

/** A permission profile: object access as `refs` tagged with a typed edge. */
export const ProfileConfigSchema = Schema.Struct({
  id: Relation.id(PROFILE_KIND, { display: "name" }),
  name: Schema.String,
  objectAccess: Relation.refs(OBJECT_KIND, { edge: "grants" }),
});
export type ProfileConfig = typeof ProfileConfigSchema.Type;

/** A user, wired to a profile (required) and a role (optional) by single id `ref`s. */
export const UserConfigSchema = Schema.Struct({
  id: Relation.id(USER_KIND, { display: "email" }),
  email: Schema.String,
  profileId: Relation.ref(PROFILE_KIND),
  roleId: Schema.optional(Relation.ref(ROLE_KIND)),
});
export type UserConfig = typeof UserConfigSchema.Type;

// ── workspace ─────────────────────────────────────────────────────────────────

/** The whole-org value the relation graph is built from. */
export const SalesforceWorkspaceSchema = Schema.Struct({
  org: Schema.NullOr(OrgConfigSchema),
  valueSets: Schema.Array(ValueSetConfigSchema),
  objects: Schema.Array(ObjectConfigSchema),
  roles: Schema.Array(RoleConfigSchema),
  profiles: Schema.Array(ProfileConfigSchema),
  users: Schema.Array(UserConfigSchema),
});
export type SalesforceWorkspaceValue = typeof SalesforceWorkspaceSchema.Type;

// ── artifact project (file routing) ───────────────────────────────────────────

// The framework's project-file artifact carries the decodedValue/JSON-schema
// view handlers the standalone `web`/RPC IDE requests; a bare ArtifactType
// leaves that IDE stuck on "Loading project".
const projectFileArtifact = SchematicsProjectFileArtifact as unknown as AnyArtifactType;

export const SalesforceArtifactProject = ArtifactProject.make("salesforce-yaml")
  .files("org.yaml", {
    id: "Org",
    type: projectFileArtifact,
    schema: OrgConfigSchema,
    metadata: {
      attributes: {
        schemaId: "Org",
        workspaceField: "org",
        single: true,
        format: "yaml",
        description: "The Salesforce org container",
      },
    },
  })
  .files("value-sets/*.yaml", {
    id: "ValueSets",
    type: projectFileArtifact,
    schema: ValueSetConfigSchema,
    metadata: {
      attributes: {
        schemaId: "ValueSets",
        workspaceField: "valueSets",
        values: true,
        format: "yaml",
        description: "Global picklist value sets",
      },
    },
  })
  .files("objects/*.yaml", {
    id: "Objects",
    type: projectFileArtifact,
    schema: ObjectConfigSchema,
    metadata: {
      attributes: {
        schemaId: "Objects",
        workspaceField: "objects",
        values: true,
        format: "yaml",
        description: "Standard and custom objects with fields and validation rules",
      },
    },
  })
  .files("roles/*.yaml", {
    id: "Roles",
    type: projectFileArtifact,
    schema: RoleConfigSchema,
    metadata: {
      attributes: {
        schemaId: "Roles",
        workspaceField: "roles",
        values: true,
        format: "yaml",
        description: "The role hierarchy",
      },
    },
  })
  .files("profiles/*.yaml", {
    id: "Profiles",
    type: projectFileArtifact,
    schema: ProfileConfigSchema,
    metadata: {
      attributes: {
        schemaId: "Profiles",
        workspaceField: "profiles",
        values: true,
        format: "yaml",
        description: "Permission profiles",
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
        description: "Users assigned to profiles and roles",
      },
    },
  });

// ── cross-file diagnostics ────────────────────────────────────────────────────

const DOCUMENT_FIELDS: Record<string, string | undefined> = {
  [ORG_KIND]: "org",
  [VALUE_SET_KIND]: "valueSets",
  [OBJECT_KIND]: "objects",
  [ROLE_KIND]: "roles",
  [PROFILE_KIND]: "profiles",
  [USER_KIND]: "users",
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
  return diagnostic.path.length > 0 ? Relation.key(diagnostic.path).join(".") : "org";
}

/** Cross-file workspace diagnostics: duplicate ids and unresolved references. */
export function validateSalesforceWorkspaceValue(
  workspace: SalesforceWorkspaceValue,
): readonly SchematicsDiagnostic[] {
  return validateRelations(SalesforceWorkspaceSchema, workspace).map((diagnostic) => ({
    path: diagnostic.path.length > 0 ? Relation.key(diagnostic.path).join(".") : null,
    documentPath: documentPathFor(diagnostic),
    severity: diagnostic.severity === "warning" ? "warning" : "error",
    source: "cross-file",
    message: friendlyMessage(diagnostic),
  }));
}

export const SalesforceProjectBaseSchema = Project.fromArtifactProject(SalesforceArtifactProject);

export const SalesforceProjectSchema = SalesforceProjectBaseSchema.pipe(
  Project.validate<SalesforceWorkspaceValue>(
    "salesforce org references resolve",
    (workspace, issue) => {
      for (const diagnostic of validateSalesforceWorkspaceValue(workspace)) {
        issue.at(diagnostic.documentPath ?? "org", diagnostic.message, diagnostic.path);
      }
    },
  ),
);
