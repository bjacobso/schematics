import { Schema } from "effect";
import { RuleDtoSchema, type PolicyCreateDto, type PolicyDto, type PolicyUpdateDto } from "../domain";
import { FORM_KIND, type RefResolver } from "./refs";

/**
 * Config-file shape for a policy. Slug `id`; `forms` references forms **by slug**
 * (resolved to/from uids via the {@link RefResolver}); `pcy_…` and timestamps
 * dropped.
 */
export const OnboardedPolicyConfigSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.String,
  description: Schema.optional(Schema.String),
  rules: RuleDtoSchema,
  forms: Schema.optional(Schema.Array(Schema.String)),
  tags: Schema.optional(Schema.Array(Schema.String)),
});
export type OnboardedPolicyConfig = typeof OnboardedPolicyConfigSchema.Type;

export const policyConfigFromDto = (dto: PolicyDto, resolve: RefResolver): OnboardedPolicyConfig => ({
  id: dto.id, // placeholder; engine pins the slug
  name: dto.name,
  status: dto.status,
  description: dto.description ?? undefined,
  rules: dto.rules,
  forms: dto.forms.map((form) => resolve.toKey(FORM_KIND, form.id) ?? form.id),
  tags: dto.tags.map((tag) => tag.name),
});

export const policyCreateDtoFromConfig = (
  config: OnboardedPolicyConfig,
  resolve: RefResolver,
): PolicyCreateDto => ({
  name: config.name,
  description: config.description ?? null,
  rules: config.rules,
  status: config.status,
  tags: config.tags ?? [],
  formIds: (config.forms ?? []).flatMap((slug) => {
    const uid = resolve.toRemoteId(FORM_KIND, slug);
    return uid ? [uid] : [];
  }),
});

export const policyUpdateDtoFromConfig = (
  config: OnboardedPolicyConfig,
  resolve: RefResolver,
): PolicyUpdateDto => ({
  name: config.name,
  description: config.description ?? null,
  rules: config.rules,
  status: config.status,
  tagNames: config.tags ?? [],
  formIds: (config.forms ?? []).flatMap((slug) => {
    const uid = resolve.toRemoteId(FORM_KIND, slug);
    return uid ? [uid] : [];
  }),
});
