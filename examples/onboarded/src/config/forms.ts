import { Relation } from "@schematics/algebra";
import { Schema } from "effect";
import {
  FormAccessTypeSchema,
  FormScopeDtoSchema,
  type FormCreateDto,
  type FormDto,
  type FormUpdateDto,
} from "../domain/forms";
import { CUSTOM_PROPERTY_KIND, FORM_KIND } from "./refs";

/**
 * Config-file shape for a form. Slug `id`; server-only fields (uid, blueprint,
 * timestamps) dropped. `policies` is NOT here — the link is owned by the policy
 * side (`policy.forms`), so it stays derived.
 */
export const OnboardedFormConfigSchema = Schema.Struct({
  id: Relation.id(FORM_KIND, { display: "name" }),
  name: Schema.String,
  description: Schema.optional(Schema.String),
  accessType: FormAccessTypeSchema,
  scope: FormScopeDtoSchema,
  tags: Schema.optional(Schema.Array(Schema.String)),
  trackConversion: Schema.optional(Schema.Boolean),
  attributePaths: Schema.optional(Relation.pathRefs(CUSTOM_PROPERTY_KIND)),
});
export type OnboardedFormConfig = typeof OnboardedFormConfigSchema.Type;

export const formConfigFromDto = (dto: FormDto): OnboardedFormConfig => ({
  id: dto.uid, // placeholder; the engine pins the slug via applyKey
  name: dto.name,
  description: dto.description ?? undefined,
  accessType: dto.access_type,
  scope: dto.scope,
  tags: dto.tags.map((tag) => tag.name),
  trackConversion: dto.track_conversion,
  attributePaths: dto.attribute_scopes?.map((scope) => scope.field_path) ?? [],
});

export const formCreateDtoFromConfig = (config: OnboardedFormConfig): FormCreateDto => ({
  name: config.name,
  description: config.description ?? null,
  scope: config.scope,
  custom_attributes: null,
  tags: config.tags ?? [],
  access_type: config.accessType,
  track_conversion: config.trackConversion ?? false,
  attribute_scope_paths: config.attributePaths ?? [],
});

export const formUpdateDtoFromConfig = (config: OnboardedFormConfig): FormUpdateDto => ({
  name: config.name,
  description: config.description ?? null,
  scope: config.scope,
  tags: config.tags ?? [],
  track_conversion: config.trackConversion ?? false,
  attribute_scope_paths: config.attributePaths ?? [],
});
