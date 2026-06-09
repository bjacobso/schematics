import { defineResource } from "@schematics/provider";
import {
  EscalationPolicyConfigSchema,
  ESCALATION_POLICY_KIND,
  ScheduleConfigSchema,
  SCHEDULE_KIND,
  ServiceConfigSchema,
  SERVICE_KIND,
  TeamConfigSchema,
  TEAM_KIND,
  UserConfigSchema,
  USER_KIND,
} from "./schema";

export const pagerDutyResources = [
  defineResource<typeof TeamConfigSchema.Type>({
    kind: TEAM_KIND,
    schemaId: "Teams",
    schema: TeamConfigSchema,
    description: "Teams that own services and schedules",
  }),
  defineResource<typeof UserConfigSchema.Type>({
    kind: USER_KIND,
    schemaId: "Users",
    schema: UserConfigSchema,
    description: "Responders placed into schedule rotations",
  }),
  defineResource<typeof ScheduleConfigSchema.Type>({
    kind: SCHEDULE_KIND,
    schemaId: "Schedules",
    schema: ScheduleConfigSchema,
    description: "On-call schedules with a user rotation",
  }),
  defineResource<typeof EscalationPolicyConfigSchema.Type>({
    kind: ESCALATION_POLICY_KIND,
    schemaId: "EscalationPolicies",
    schema: EscalationPolicyConfigSchema,
    route: "escalation-policies/*.yaml",
    description: "Escalation policies that escalate through schedules",
  }),
  defineResource<typeof ServiceConfigSchema.Type>({
    kind: SERVICE_KIND,
    schemaId: "Services",
    schema: ServiceConfigSchema,
    description: "Monitored services wired to an escalation policy",
  }),
];
