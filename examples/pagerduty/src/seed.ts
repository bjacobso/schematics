import type {
  EscalationPolicyConfig,
  ScheduleConfig,
  ServiceConfig,
  TeamConfig,
  UserConfig,
} from "./schema";

export interface PagerDutySeed extends Readonly<Record<string, readonly unknown[]>> {
  readonly teams: readonly TeamConfig[];
  readonly users: readonly UserConfig[];
  readonly schedules: readonly ScheduleConfig[];
  readonly escalationPolicies: readonly EscalationPolicyConfig[];
  readonly services: readonly ServiceConfig[];
}

export const acmePagerDutySeed: PagerDutySeed = {
  teams: [
    { id: "platform", name: "Platform" },
    { id: "payments", name: "Payments" },
  ],
  users: [
    { id: "alice", name: "Alice Ng", email: "alice@acme.example" },
    { id: "bob", name: "Bob Reyes", email: "bob@acme.example" },
    { id: "carol", name: "Carol Singh", email: "carol@acme.example" },
  ],
  schedules: [
    {
      id: "platform-weekday",
      name: "Platform Weekday",
      team: "platform",
      rotation: ["alice", "bob"],
    },
    { id: "payments-primary", name: "Payments Primary", team: "payments", rotation: ["carol"] },
  ],
  escalationPolicies: [
    {
      id: "platform-ep",
      name: "Platform Escalation",
      team: "platform",
      schedules: ["platform-weekday"],
    },
    {
      id: "payments-ep",
      name: "Payments Escalation",
      team: "payments",
      schedules: ["payments-primary", "platform-weekday"],
    },
  ],
  services: [
    { id: "api", name: "API Gateway", team: "platform", escalationPolicy: "platform-ep" },
    { id: "checkout", name: "Checkout", team: "payments", escalationPolicy: "payments-ep" },
  ],
};

export const pagerDutySeeds = {
  acme: acmePagerDutySeed,
} as const satisfies Record<string, PagerDutySeed>;
export type PagerDutySeedName = keyof typeof pagerDutySeeds;
