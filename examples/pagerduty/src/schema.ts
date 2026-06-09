import { Relation } from "@schematics/algebra";
import { Schema } from "effect";

export const TEAM_KIND = "team";
export const USER_KIND = "user";
export const SCHEDULE_KIND = "schedule";
export const ESCALATION_POLICY_KIND = "escalationPolicy";
export const SERVICE_KIND = "service";

export const TeamConfigSchema = Schema.Struct({
  id: Relation.id(TEAM_KIND, { display: "name" }),
  name: Schema.String,
});
export type TeamConfig = typeof TeamConfigSchema.Type;

export const UserConfigSchema = Schema.Struct({
  id: Relation.id(USER_KIND, { display: "name" }),
  name: Schema.String,
  email: Schema.String,
});
export type UserConfig = typeof UserConfigSchema.Type;

export const ScheduleConfigSchema = Schema.Struct({
  id: Relation.id(SCHEDULE_KIND, { display: "name" }),
  name: Schema.String,
  team: Schema.optional(Relation.ref(TEAM_KIND)),
  rotation: Relation.refs(USER_KIND, { edge: "rotates" }),
});
export type ScheduleConfig = typeof ScheduleConfigSchema.Type;

export const EscalationPolicyConfigSchema = Schema.Struct({
  id: Relation.id(ESCALATION_POLICY_KIND, { display: "name" }),
  name: Schema.String,
  team: Schema.optional(Relation.ref(TEAM_KIND)),
  schedules: Relation.refs(SCHEDULE_KIND, { edge: "escalatesTo" }),
});
export type EscalationPolicyConfig = typeof EscalationPolicyConfigSchema.Type;

export const ServiceConfigSchema = Schema.Struct({
  id: Relation.id(SERVICE_KIND, { display: "name" }),
  name: Schema.String,
  team: Schema.optional(Relation.ref(TEAM_KIND)),
  escalationPolicy: Relation.ref(ESCALATION_POLICY_KIND),
});
export type ServiceConfig = typeof ServiceConfigSchema.Type;

export const PagerDutyWorkspaceSchema = Schema.Struct({
  teams: Schema.Array(TeamConfigSchema),
  users: Schema.Array(UserConfigSchema),
  schedules: Schema.Array(ScheduleConfigSchema),
  escalationPolicies: Schema.Array(EscalationPolicyConfigSchema),
  services: Schema.Array(ServiceConfigSchema),
});
export type PagerDutyWorkspaceValue = typeof PagerDutyWorkspaceSchema.Type;
