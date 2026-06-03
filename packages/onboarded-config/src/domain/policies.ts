import { Schema } from "effect";
import { RuleDtoSchema, TagDtoSchema } from "./shared";

/** Mirror of the domain Policy resource (internal `/policies`). Id prefix `pcy_`. */

export const PolicyFormRefDtoSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  ai_summary: Schema.NullOr(Schema.String),
  ai_summary_generation_status: Schema.NullOr(Schema.String),
});

export const PolicyDtoSchema = Schema.Struct({
  id: Schema.String, // pcy_
  name: Schema.String,
  status: Schema.String,
  description: Schema.NullOr(Schema.String),
  rules: RuleDtoSchema,
  created_at: Schema.String,
  updated_at: Schema.String,
  tags: Schema.Array(TagDtoSchema),
  forms: Schema.Array(PolicyFormRefDtoSchema),
  isGlobalAssignedToAccount: Schema.optional(Schema.Boolean),
  ai_summary: Schema.NullOr(Schema.String),
  ai_summary_generation_status: Schema.NullOr(Schema.String),
});
export type PolicyDto = typeof PolicyDtoSchema.Type;

export const PolicyCreateDtoSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  rules: RuleDtoSchema,
  status: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  formIds: Schema.optional(Schema.Array(Schema.String)),
});
export type PolicyCreateDto = typeof PolicyCreateDtoSchema.Type;

export const PolicyUpdateDtoSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  rules: Schema.optional(RuleDtoSchema),
  status: Schema.optional(Schema.String),
  tagNames: Schema.optional(Schema.Array(Schema.String)),
  formIds: Schema.optional(Schema.Array(Schema.String)),
});
export type PolicyUpdateDto = typeof PolicyUpdateDtoSchema.Type;
