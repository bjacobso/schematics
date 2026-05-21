import { Schema } from "effect";

export const RuleOperatorSchema = Schema.Literals([
  "equal",
  "notEqual",
  "lessThan",
  "lessThanInclusive",
  "greaterThan",
  "greaterThanInclusive",
  "in",
  "notIn",
  "contains",
  "doesNotContain",
  "exists",
  "doesNotExist",
]);

export interface RuleAll {
  readonly all: readonly Rule[];
}

export interface RuleAny {
  readonly any: readonly Rule[];
}

export interface RuleCondition {
  readonly fact: string;
  readonly path?: string | undefined;
  readonly operator: typeof RuleOperatorSchema.Type;
  readonly value: unknown;
}

export type Rule = RuleAll | RuleAny | RuleCondition;

const RuleAllSchema: Schema.Schema<RuleAll> = Schema.Struct({
  all: Schema.Array(Schema.suspend(() => OnboardedRuleSchema)),
});
const RuleAnySchema: Schema.Schema<RuleAny> = Schema.Struct({
  any: Schema.Array(Schema.suspend(() => OnboardedRuleSchema)),
});
const RuleConditionSchema: Schema.Schema<RuleCondition> = Schema.Struct({
  fact: Schema.String,
  path: Schema.optional(Schema.String),
  operator: RuleOperatorSchema,
  value: Schema.Unknown,
});

export const OnboardedRuleSchema: Schema.Schema<Rule> = Schema.Union([
  RuleAllSchema,
  RuleAnySchema,
  RuleConditionSchema,
]);

export function collectRuleConditions(rule: Rule): readonly RuleCondition[] {
  if ("all" in rule) return rule.all.flatMap((child) => collectRuleConditions(child));
  if ("any" in rule) return rule.any.flatMap((child) => collectRuleConditions(child));
  return [rule];
}
