import { Schema } from "effect";

/**
 * Faithful mirrors of shared Onboarded domain (`@onboarded/domain`) schemas.
 * These are the "wire" DTOs the mock OnboardedApi returns; config-file schemas
 * map to/from them in the providers.
 */

/** Tag as embedded on forms/policies (`{ name, color, is_inherited }`). */
export const TagDtoSchema = Schema.Struct({
  name: Schema.String,
  color: Schema.NullOr(Schema.String),
  is_inherited: Schema.Boolean,
});
export type TagDto = typeof TagDtoSchema.Type;

/** Form subscription / auto-upgrade config (discriminated on `autoDeployFormVersion`). */
export const TaskUpgradeModeSchema = Schema.Literals([
  "NONE",
  "ALL",
  "MAJOR",
  "MINOR",
  "none",
  "unstarted",
  "started_and_unstarted",
] as const);
export const AutoUpgradeConfigSchema = Schema.Union([
  Schema.Struct({
    autoDeployFormVersion: Schema.Literal(false),
    taskUpgradeMode: TaskUpgradeModeSchema,
  }),
  Schema.Struct({
    autoDeployFormVersion: Schema.Literal(true),
    taskUpgradeMode: TaskUpgradeModeSchema,
  }),
]);
export type AutoUpgradeConfig = typeof AutoUpgradeConfigSchema.Type;

/** Re-export the domain Rule union (already modeled in `../rules`). */
export { OnboardedRuleSchema as RuleDtoSchema, type Rule as RuleDto } from "../rules";
