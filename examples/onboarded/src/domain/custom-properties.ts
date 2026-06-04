import { Schema } from "effect";

/** Mirror of the domain CustomProperty resource (internal `/custom_properties`). */
export const ScalarTypeDtoSchema = Schema.Literals([
  "string",
  "number",
  "integer",
  "decimal",
  "boolean",
  "date",
  "datetime",
  "enum",
  "json",
  "address",
] as const);

export const CustomPropertyDtoSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  scalarType: ScalarTypeDtoSchema,
  entityType: Schema.String,
  is_system_property: Schema.Boolean,
  is_core_entity_api_resource: Schema.Boolean,
  is_searchable: Schema.Boolean,
  is_sensitive_info: Schema.Boolean,
  is_permission_scope: Schema.Boolean,
  auto_distribute_to_connected: Schema.Boolean,
  label: Schema.String,
  description: Schema.optional(Schema.String),
  created_at: Schema.String,
  deprecated_at: Schema.NullOr(Schema.String),
});
export type CustomPropertyDto = typeof CustomPropertyDtoSchema.Type;
