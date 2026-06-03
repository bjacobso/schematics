import { Schema } from "effect";
import { ScalarTypeDtoSchema, type CustomPropertyDto } from "../domain/custom-properties";

/**
 * Config-file shape for a custom property (attribute). Natural key is `path` —
 * stable and human-meaningful, so no slug invention is needed here.
 */
export const OnboardedCustomPropertyConfigSchema = Schema.Struct({
  path: Schema.String,
  label: Schema.String,
  scalarType: ScalarTypeDtoSchema,
  entityType: Schema.String,
  description: Schema.optional(Schema.String),
  searchable: Schema.optional(Schema.Boolean),
  sensitive: Schema.optional(Schema.Boolean),
  autoDistribute: Schema.optional(Schema.Boolean),
});
export type OnboardedCustomPropertyConfig = typeof OnboardedCustomPropertyConfigSchema.Type;

export const customPropertyConfigFromDto = (
  dto: CustomPropertyDto,
): OnboardedCustomPropertyConfig => ({
  path: dto.path,
  label: dto.label,
  scalarType: dto.scalarType,
  entityType: dto.entityType,
  description: dto.description,
  searchable: dto.is_searchable,
  sensitive: dto.is_sensitive_info,
  autoDistribute: dto.auto_distribute_to_connected,
});

/** Build a full CustomProperty DTO for create (the mock fills `id`/`created_at`). */
export const customPropertyDtoFromConfig = (
  config: OnboardedCustomPropertyConfig,
): CustomPropertyDto => ({
  id: "",
  name: config.label,
  path: config.path,
  scalarType: config.scalarType,
  entityType: config.entityType,
  is_system_property: false,
  is_core_entity_api_resource: false,
  is_searchable: config.searchable ?? false,
  is_sensitive_info: config.sensitive ?? false,
  is_permission_scope: false,
  auto_distribute_to_connected: config.autoDistribute ?? false,
  label: config.label,
  description: config.description,
  created_at: "",
  deprecated_at: null,
});
