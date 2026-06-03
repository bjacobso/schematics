import { Data, Effect } from "effect";
import type { AccountDto } from "../domain/account";
import type {
  AutomationDetailDto,
  AutomationDto,
  AutomationImportExportDto,
} from "../domain/automations";
import type { CustomPropertyDto } from "../domain/custom-properties";
import type { FormCreateDto, FormDto, FormUpdateDto } from "../domain/forms";
import type { PolicyCreateDto, PolicyDto, PolicyUpdateDto } from "../domain/policies";
import { seedOnboardedData, type OnboardedSeed } from "./seed";

/**
 * A mock of the Onboarded domain HttpApi as a plain in-memory Effect service.
 *
 * Each sub-API mirrors the shapes of the real internal endpoints (returning the
 * faithful DTOs), is backed by `Map`s keyed by the real id (`acc_`/`pcy_`/
 * `auto_`/uid), seeded with cross-referential sample data, and records every
 * call on `calls` so you can play with / assert the traffic.
 */
export class OnboardedApiError extends Data.TaggedError("OnboardedApiError")<{
  readonly group: string;
  readonly operation: string;
  readonly id?: string | undefined;
  readonly message: string;
}> {}

export interface OnboardedApiCall {
  readonly group: string;
  readonly operation: string;
  readonly id?: string | undefined;
}

export interface OnboardedAccountsApi {
  readonly list: Effect.Effect<readonly AccountDto[], OnboardedApiError>;
}

export interface OnboardedCustomPropertiesApi {
  readonly list: Effect.Effect<readonly CustomPropertyDto[], OnboardedApiError>;
  readonly create: (
    property: CustomPropertyDto,
  ) => Effect.Effect<CustomPropertyDto, OnboardedApiError>;
  readonly deprecate: (id: string) => Effect.Effect<CustomPropertyDto, OnboardedApiError>;
}

export interface OnboardedFormsApi {
  readonly list: Effect.Effect<readonly FormDto[], OnboardedApiError>;
  readonly get: (uid: string) => Effect.Effect<FormDto | null, OnboardedApiError>;
  readonly create: (body: FormCreateDto) => Effect.Effect<FormDto, OnboardedApiError>;
  readonly update: (uid: string, body: FormUpdateDto) => Effect.Effect<FormDto, OnboardedApiError>;
  readonly delete: (uid: string) => Effect.Effect<void, OnboardedApiError>;
}

export interface OnboardedPoliciesApi {
  readonly list: Effect.Effect<readonly PolicyDto[], OnboardedApiError>;
  readonly get: (id: string) => Effect.Effect<PolicyDto | null, OnboardedApiError>;
  readonly create: (body: PolicyCreateDto) => Effect.Effect<PolicyDto, OnboardedApiError>;
  readonly update: (
    id: string,
    body: PolicyUpdateDto,
  ) => Effect.Effect<PolicyDto, OnboardedApiError>;
  readonly delete: (id: string) => Effect.Effect<void, OnboardedApiError>;
}

export interface OnboardedAutomationsApi {
  readonly list: Effect.Effect<readonly AutomationDto[], OnboardedApiError>;
  readonly get: (id: string) => Effect.Effect<AutomationDetailDto | null, OnboardedApiError>;
  readonly import: (
    body: AutomationImportExportDto,
  ) => Effect.Effect<AutomationDetailDto, OnboardedApiError>;
  readonly delete: (id: string) => Effect.Effect<void, OnboardedApiError>;
}

export interface OnboardedApi {
  readonly accounts: OnboardedAccountsApi;
  readonly customProperties: OnboardedCustomPropertiesApi;
  readonly forms: OnboardedFormsApi;
  readonly policies: OnboardedPoliciesApi;
  readonly automations: OnboardedAutomationsApi;
  /** Every call made through the mock, in order. */
  readonly calls: OnboardedApiCall[];
}

export interface MockOnboardedApi extends OnboardedApi {
  readonly snapshot: Effect.Effect<OnboardedSeed>;
}

export interface MockOnboardedApiOptions {
  readonly seed?: OnboardedSeed | undefined;
}

export function makeMockOnboardedApi(options: MockOnboardedApiOptions = {}): MockOnboardedApi {
  const seed = options.seed ?? seedOnboardedData();
  const accounts = new Map(seed.accounts.map((a) => [a.id, a]));
  const customProperties = new Map(seed.customProperties.map((p) => [p.id, p]));
  const forms = new Map(seed.forms.map((f) => [f.uid, f]));
  const policies = new Map(seed.policies.map((p) => [p.id, p]));
  const automations = new Map(seed.automations.map((a) => [a.detail.id, a]));

  const calls: OnboardedApiCall[] = [];
  let counter = 0;
  const nextId = (prefix: string): string => {
    counter += 1;
    return `${prefix}${counter}`;
  };
  const record = (group: string, operation: string, id?: string): void => {
    calls.push(id === undefined ? { group, operation } : { group, operation, id });
  };
  const now = "2026-06-02T00:00:00.000Z";

  return {
    calls,
    snapshot: Effect.sync(() => ({
      accounts: cloneJson([...accounts.values()]),
      customProperties: cloneJson([...customProperties.values()]),
      forms: cloneJson([...forms.values()]),
      policies: cloneJson([...policies.values()]),
      automations: cloneJson([...automations.values()]),
    })),

    accounts: {
      list: Effect.sync(() => {
        record("accounts", "list");
        return [...accounts.values()];
      }),
    },

    customProperties: {
      list: Effect.sync(() => {
        record("custom_properties", "list");
        return [...customProperties.values()];
      }),
      create: (property) =>
        Effect.sync(() => {
          record("custom_properties", "create", property.id);
          const created = { ...property, id: property.id || nextId("cprop_"), created_at: now };
          customProperties.set(created.id, created);
          return created;
        }),
      deprecate: (id) =>
        Effect.gen(function* () {
          record("custom_properties", "deprecate", id);
          const existing = customProperties.get(id);
          if (!existing) return yield* missing("custom_properties", "deprecate", id);
          const updated = { ...existing, deprecated_at: now };
          customProperties.set(id, updated);
          return updated;
        }),
    },

    forms: {
      list: Effect.sync(() => {
        record("forms", "list");
        return [...forms.values()];
      }),
      get: (uid) =>
        Effect.sync(() => {
          record("forms", "get", uid);
          return forms.get(uid) ?? null;
        }),
      create: (body) =>
        Effect.sync(() => {
          record("forms", "create");
          const uid = nextId("tlin_");
          const form: FormDto = {
            uid,
            name: body.name,
            description: body.description,
            access_type: body.access_type,
            scope: body.scope,
            access_role: null,
            latest_blueprint_version: null,
            tags: body.tags.map((name) => ({ name, color: null, is_inherited: false })),
            track_conversion: body.track_conversion,
            custom_attributes: body.custom_attributes,
            attribute_scopes: body.attribute_scope_paths.map((field_path) => ({ field_path })),
            org_form_subscription: null,
            policies: [],
            created_at: now,
            updated_at: now,
          };
          forms.set(uid, form);
          return form;
        }),
      update: (uid, body) =>
        Effect.gen(function* () {
          record("forms", "update", uid);
          const existing = forms.get(uid);
          if (!existing) return yield* missing("forms", "update", uid);
          const updated: FormDto = {
            ...existing,
            name: body.name ?? existing.name,
            description: body.description ?? existing.description,
            scope: body.scope ?? existing.scope,
            custom_attributes: body.custom_attributes ?? existing.custom_attributes,
            track_conversion: body.track_conversion ?? existing.track_conversion,
            tags: body.tags
              ? body.tags.map((name) => ({ name, color: null, is_inherited: false }))
              : existing.tags,
            attribute_scopes: body.attribute_scope_paths
              ? body.attribute_scope_paths.map((field_path) => ({ field_path }))
              : existing.attribute_scopes,
            org_form_subscription: body.auto_upgrade_config ?? existing.org_form_subscription,
            updated_at: now,
          };
          forms.set(uid, updated);
          return updated;
        }),
      delete: (uid) =>
        Effect.gen(function* () {
          record("forms", "delete", uid);
          if (!forms.has(uid)) return yield* missing("forms", "delete", uid);
          forms.delete(uid);
        }),
    },

    policies: {
      list: Effect.sync(() => {
        record("policies", "list");
        return [...policies.values()];
      }),
      get: (id) =>
        Effect.sync(() => {
          record("policies", "get", id);
          return policies.get(id) ?? null;
        }),
      create: (body) =>
        Effect.sync(() => {
          record("policies", "create");
          const id = nextId("pcy_");
          const policy: PolicyDto = {
            id,
            name: body.name,
            status: body.status ?? "draft",
            description: body.description ?? null,
            rules: body.rules,
            created_at: now,
            updated_at: now,
            tags: (body.tags ?? []).map((name) => ({ name, color: null, is_inherited: false })),
            forms: (body.formIds ?? []).map((formId) => ({
              id: formId,
              name: forms.get(formId)?.name ?? formId,
              ai_summary: null,
              ai_summary_generation_status: null,
            })),
            ai_summary: null,
            ai_summary_generation_status: null,
          };
          policies.set(id, policy);
          return policy;
        }),
      update: (id, body) =>
        Effect.gen(function* () {
          record("policies", "update", id);
          const existing = policies.get(id);
          if (!existing) return yield* missing("policies", "update", id);
          const updated: PolicyDto = {
            ...existing,
            name: body.name ?? existing.name,
            description: body.description ?? existing.description,
            rules: body.rules ?? existing.rules,
            status: body.status ?? existing.status,
            tags: body.tagNames
              ? body.tagNames.map((name) => ({ name, color: null, is_inherited: false }))
              : existing.tags,
            forms: body.formIds
              ? body.formIds.map((formId) => ({
                  id: formId,
                  name: forms.get(formId)?.name ?? formId,
                  ai_summary: null,
                  ai_summary_generation_status: null,
                }))
              : existing.forms,
            updated_at: now,
          };
          policies.set(id, updated);
          return updated;
        }),
      delete: (id) =>
        Effect.gen(function* () {
          record("policies", "delete", id);
          if (!policies.has(id)) return yield* missing("policies", "delete", id);
          policies.delete(id);
        }),
    },

    automations: {
      list: Effect.sync(() => {
        record("automations", "list");
        return [...automations.values()].map((entry) => entry.summary);
      }),
      get: (id) =>
        Effect.sync(() => {
          record("automations", "get", id);
          return automations.get(id)?.detail ?? null;
        }),
      import: (body) =>
        Effect.sync(() => {
          record("automations", "import");
          const id = nextId("auto_");
          const detail: AutomationDetailDto = {
            id,
            name: body.name,
            description: body.description,
            trigger_rerun_behavior: body.trigger_rerun_behavior,
            is_dependent_on_create: body.is_dependent_on_create,
            trigger_entity: body.trigger_entity,
            dependencies: body.dependencies,
            status: "draft",
            version_number: 1,
            nodes: body.nodes,
            edges: body.edges,
          };
          const summary: AutomationDto = {
            id,
            name: body.name,
            description: body.description,
            trigger_rerun_behavior: body.trigger_rerun_behavior ?? "never",
            is_dependent_on_create: body.is_dependent_on_create,
            trigger_entity: body.trigger_entity,
            dependencies: body.dependencies,
            status: "draft",
            created_at: now,
            auto_version_id: 1,
          };
          automations.set(id, { summary, detail });
          return detail;
        }),
      delete: (id) =>
        Effect.gen(function* () {
          record("automations", "delete", id);
          if (!automations.has(id)) return yield* missing("automations", "delete", id);
          automations.delete(id);
        }),
    },
  };
}

const missing = (group: string, operation: string, id: string) =>
  Effect.fail(new OnboardedApiError({ group, operation, id, message: `${group} ${id} not found` }));

function cloneJson<A>(value: A): A {
  return JSON.parse(JSON.stringify(value)) as A;
}
