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
 * PagerDuty on-call configuration, modeled as config-as-code with
 * `@schematics/algebra`.
 *
 * This example is deliberately a *linear dependency chain* —
 * `service → escalationPolicy → schedule → user` — so the dependency-ordered
 * apply and drift story is obvious: you can't wire a service to an escalation
 * policy that doesn't exist, and deleting a schedule still referenced by a
 * policy is a resolvable, visible break.
 *
 * | Algebra ability         | Where it shows up                                     |
 * | ----------------------- | ----------------------------------------------------- |
 * | `id` + `display`        | every entity (`team`, `user`, `service`, …)           |
 * | `ref` (single, id)      | `service.escalationPolicy`, `*.team`                  |
 * | `refs` (array) + `edge` | `escalationPolicy.schedules`, `schedule.rotation`     |
 */

export const TEAM_KIND = "team";
export const USER_KIND = "user";
export const SCHEDULE_KIND = "schedule";
export const ESCALATION_POLICY_KIND = "escalationPolicy";
export const SERVICE_KIND = "service";

/** A team that owns services, schedules, and escalation policies. */
export const TeamConfigSchema = Schema.Struct({
  id: Relation.id(TEAM_KIND, { display: "name" }),
  name: Schema.String,
});
export type TeamConfig = typeof TeamConfigSchema.Type;

/** A responder — the leaf of the on-call chain. */
export const UserConfigSchema = Schema.Struct({
  id: Relation.id(USER_KIND, { display: "name" }),
  name: Schema.String,
  email: Schema.String,
});
export type UserConfig = typeof UserConfigSchema.Type;

/** An on-call schedule: users in the rotation (`refs` + edge), owned by a team. */
export const ScheduleConfigSchema = Schema.Struct({
  id: Relation.id(SCHEDULE_KIND, { display: "name" }),
  name: Schema.String,
  team: Schema.optional(Relation.ref(TEAM_KIND)),
  rotation: Relation.refs(USER_KIND, { edge: "rotates" }),
});
export type ScheduleConfig = typeof ScheduleConfigSchema.Type;

/** An escalation policy: ordered schedules it escalates through (`refs` + edge). */
export const EscalationPolicyConfigSchema = Schema.Struct({
  id: Relation.id(ESCALATION_POLICY_KIND, { display: "name" }),
  name: Schema.String,
  team: Schema.optional(Relation.ref(TEAM_KIND)),
  schedules: Relation.refs(SCHEDULE_KIND, { edge: "escalatesTo" }),
});
export type EscalationPolicyConfig = typeof EscalationPolicyConfigSchema.Type;

/** A monitored service, wired to one escalation policy and an owning team. */
export const ServiceConfigSchema = Schema.Struct({
  id: Relation.id(SERVICE_KIND, { display: "name" }),
  name: Schema.String,
  team: Schema.optional(Relation.ref(TEAM_KIND)),
  escalationPolicy: Relation.ref(ESCALATION_POLICY_KIND),
});
export type ServiceConfig = typeof ServiceConfigSchema.Type;

/** The whole on-call value the relation graph is built from. */
export const PagerDutyWorkspaceSchema = Schema.Struct({
  teams: Schema.Array(TeamConfigSchema),
  users: Schema.Array(UserConfigSchema),
  schedules: Schema.Array(ScheduleConfigSchema),
  escalationPolicies: Schema.Array(EscalationPolicyConfigSchema),
  services: Schema.Array(ServiceConfigSchema),
});
export type PagerDutyWorkspaceValue = typeof PagerDutyWorkspaceSchema.Type;

// The framework's project-file artifact carries the view handlers the
// standalone `web`/RPC IDE requests; a bare ArtifactType leaves it on "Loading".
const projectFileArtifact = SchematicsProjectFileArtifact as unknown as AnyArtifactType;

export const PagerDutyArtifactProject = ArtifactProject.make("pagerduty-yaml")
  .files("teams/*.yaml", {
    id: "Teams",
    type: projectFileArtifact,
    schema: TeamConfigSchema,
    metadata: {
      attributes: {
        schemaId: "Teams",
        workspaceField: "teams",
        values: true,
        format: "yaml",
        description: "Teams that own services and schedules",
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
        description: "Responders placed into schedule rotations",
      },
    },
  })
  .files("schedules/*.yaml", {
    id: "Schedules",
    type: projectFileArtifact,
    schema: ScheduleConfigSchema,
    metadata: {
      attributes: {
        schemaId: "Schedules",
        workspaceField: "schedules",
        values: true,
        format: "yaml",
        description: "On-call schedules with a user rotation",
      },
    },
  })
  .files("escalation-policies/*.yaml", {
    id: "EscalationPolicies",
    type: projectFileArtifact,
    schema: EscalationPolicyConfigSchema,
    metadata: {
      attributes: {
        schemaId: "EscalationPolicies",
        workspaceField: "escalationPolicies",
        values: true,
        format: "yaml",
        description: "Escalation policies that escalate through schedules",
      },
    },
  })
  .files("services/*.yaml", {
    id: "Services",
    type: projectFileArtifact,
    schema: ServiceConfigSchema,
    metadata: {
      attributes: {
        schemaId: "Services",
        workspaceField: "services",
        values: true,
        format: "yaml",
        description: "Monitored services wired to an escalation policy",
      },
    },
  });

const DOCUMENT_FIELDS: Record<string, string | undefined> = {
  [TEAM_KIND]: "teams",
  [USER_KIND]: "users",
  [SCHEDULE_KIND]: "schedules",
  [ESCALATION_POLICY_KIND]: "escalationPolicies",
  [SERVICE_KIND]: "services",
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
  return diagnostic.path.length > 0 ? Relation.key(diagnostic.path).join(".") : "services";
}

/** Cross-file workspace diagnostics: duplicate ids and unresolved references. */
export function validatePagerDutyWorkspaceValue(
  workspace: PagerDutyWorkspaceValue,
): readonly SchematicsDiagnostic[] {
  return validateRelations(PagerDutyWorkspaceSchema, workspace).map((diagnostic) => ({
    path: diagnostic.path.length > 0 ? Relation.key(diagnostic.path).join(".") : null,
    documentPath: documentPathFor(diagnostic),
    severity: diagnostic.severity === "warning" ? "warning" : "error",
    source: "cross-file",
    message: friendlyMessage(diagnostic),
  }));
}

export const PagerDutyProjectBaseSchema = Project.fromArtifactProject(PagerDutyArtifactProject);

export const PagerDutyProjectSchema = PagerDutyProjectBaseSchema.pipe(
  Project.validate<PagerDutyWorkspaceValue>(
    "pagerduty on-call references resolve",
    (workspace, issue) => {
      for (const diagnostic of validatePagerDutyWorkspaceValue(workspace)) {
        issue.at(diagnostic.documentPath ?? "services", diagnostic.message, diagnostic.path);
      }
    },
  ),
);
