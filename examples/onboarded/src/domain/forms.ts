import { Schema } from "effect";
import { AutoUpgradeConfigSchema, TagDtoSchema } from "./shared";

/** Mirror of the domain Form resource (internal `/forms`). Stable id is `uid`. */

export const NestedTaskTemplateDtoSchema = Schema.Struct({
  task_template_uid: Schema.String,
  status: Schema.Literals(["draft", "published", "deprecated"] as const),
  full_version: Schema.NullOr(Schema.String),
  major_version: Schema.NullOr(Schema.Number),
  minor_version: Schema.NullOr(Schema.Number),
  patch_version: Schema.NullOr(Schema.Number),
});

export const FormScopeDtoSchema = Schema.Struct({
  employer: Schema.Boolean,
  client: Schema.Boolean,
  job: Schema.Boolean,
});

export const FormAccessTypeSchema = Schema.Literals(["organization", "global", "account"] as const);

/** Embedded policy reference on a form. */
export const FormPolicyRefDtoSchema = Schema.Struct({
  uid: Schema.String,
  name: Schema.String,
  status: Schema.String,
});

export const FormDtoSchema = Schema.Struct({
  uid: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  access_type: FormAccessTypeSchema,
  scope: FormScopeDtoSchema,
  access_role: Schema.NullOr(Schema.Literals(["owner"] as const)),
  latest_blueprint_version: Schema.NullOr(NestedTaskTemplateDtoSchema),
  tags: Schema.Array(TagDtoSchema),
  track_conversion: Schema.Boolean,
  custom_attributes: Schema.Unknown,
  attribute_scopes: Schema.NullOr(Schema.Array(Schema.Struct({ field_path: Schema.String }))),
  org_form_subscription: Schema.NullOr(AutoUpgradeConfigSchema),
  policies: Schema.Array(FormPolicyRefDtoSchema),
  created_at: Schema.String,
  updated_at: Schema.String,
});
export type FormDto = typeof FormDtoSchema.Type;

/** Request bodies (tags + attribute scopes flatten to string arrays). */
export const FormCreateDtoSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  scope: FormScopeDtoSchema,
  custom_attributes: Schema.Unknown,
  tags: Schema.Array(Schema.String),
  access_type: FormAccessTypeSchema,
  track_conversion: Schema.Boolean,
  attribute_scope_paths: Schema.Array(Schema.String),
});
export type FormCreateDto = typeof FormCreateDtoSchema.Type;

export const FormUpdateDtoSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  scope: Schema.optional(FormScopeDtoSchema),
  custom_attributes: Schema.optional(Schema.Unknown),
  tags: Schema.optional(Schema.Array(Schema.String)),
  track_conversion: Schema.optional(Schema.Boolean),
  attribute_scope_paths: Schema.optional(Schema.Array(Schema.String)),
  auto_upgrade_config: Schema.optional(AutoUpgradeConfigSchema),
});
export type FormUpdateDto = typeof FormUpdateDtoSchema.Type;
