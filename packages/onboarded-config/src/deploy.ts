import type { ArtifactStore } from "@schema-ide/artifacts";
import {
  artifactConfigStateStore,
  makeConfigDeploy,
  ProviderError,
  type ApplyContext,
  type ConfigCodec,
  type ConfigDeploy,
  type ConfigProvider,
  type ConfigState,
  type ConfigStateStore,
  type ProviderOperation,
  type RemoteEntity,
} from "@schema-ide/config-deploy";
import { parseYaml, stringifyDocument } from "@schema-ide/core";
import { Effect, Result, Schema } from "effect";
import {
  accountConfigFromDto,
  automationConfigFromDto,
  automationFormRefSlugs,
  automationImportDtoFromConfig,
  customPropertyConfigFromDto,
  customPropertyDtoFromConfig,
  formConfigFromDto,
  formCreateDtoFromConfig,
  formUpdateDtoFromConfig,
  policyConfigFromDto,
  policyCreateDtoFromConfig,
  policyUpdateDtoFromConfig,
  OnboardedAccountConfigSchema,
  OnboardedAutomationConfigSchema,
  OnboardedCustomPropertyConfigSchema,
  OnboardedFormConfigSchema,
  OnboardedPolicyConfigSchema,
  ACCOUNT_KIND,
  AUTOMATION_KIND,
  CUSTOM_PROPERTY_KIND,
  FORM_KIND,
  POLICY_KIND,
  type OnboardedAccountConfig,
  type OnboardedAutomationConfig,
  type OnboardedCustomPropertyConfig,
  type OnboardedFormConfig,
  type OnboardedPolicyConfig,
  type RefResolver,
} from "./config";
import { makeMockOnboardedApi, type OnboardedApi, type OnboardedApiError } from "./mock";

/**
 * Layer 2 — wires the five Onboarded entity providers into the config-deploy
 * engine, backed by an {@link OnboardedApi} (the in-memory mock by default).
 *
 * Each provider maps the slug-keyed config-file shape ⇄ the domain DTOs. The
 * lockfile resolves cross-entity references: a policy lists its forms by slug,
 * which become `formIds` (uids) on write (via the apply context) and back to
 * slugs on read (via a lockfile snapshot).
 */

/** Reserved tag a real adapter would use to mark/scope config-managed entities. */
export const ONBOARDED_MANAGED_TAG = "_managed_by_config_as_code";

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "item";
}

const mapApiError =
  (kind: string, operation: ProviderOperation, key?: string) =>
  (error: OnboardedApiError): ProviderError =>
    new ProviderError({ kind, operation, key, message: error.message });

const readOnly = (kind: string, operation: ProviderOperation) =>
  new ProviderError({ kind, operation, message: `${kind} is read-only via config-as-code` });

const unsupported = (kind: string, operation: ProviderOperation, why: string) =>
  new ProviderError({ kind, operation, message: why });

const lockfileError =
  (kind: string, operation: ProviderOperation, key?: string) =>
  (): ProviderError =>
    new ProviderError({ kind, operation, key, message: "failed to read the lockfile" });

/** Build a synchronous ref resolver from a lockfile snapshot (read direction). */
function resolverFromState(state: ConfigState): RefResolver {
  const toRemote = new Map(state.entries.map((e) => [`${e.kind}:${e.key}`, e.remoteId]));
  const toSlug = new Map(state.entries.map((e) => [`${e.kind}:${e.remoteId}`, e.key]));
  return {
    toRemoteId: (kind, key) => toRemote.get(`${kind}:${key}`) ?? null,
    toKey: (kind, remoteId) => toSlug.get(`${kind}:${remoteId}`) ?? null,
  };
}

/** Adapt an ApplyContext (write direction only) into a RefResolver. */
const writeResolver = (context: ApplyContext): RefResolver => ({
  toRemoteId: (kind, key) => context.resolveRemoteId(kind, key),
  toKey: () => null,
});

// ── account (read-only) ─────────────────────────────────────────────────────

function accountProvider(api: OnboardedApi): ConfigProvider<OnboardedAccountConfig> {
  return {
    kind: ACCOUNT_KIND,
    schema: OnboardedAccountConfigSchema,
    keyOf: (config) => config.id,
    suggestKey: (entity) => entity.props.id,
    applyKey: (config, key) => ({ ...config, id: key }),
    pathFor: () => "account.yaml",
    route: "account.yaml",
    listSummaries: api.accounts.list.pipe(
      Effect.map((accounts) => accounts.map((a) => ({ remoteId: a.id, suggestedKey: a.id }))),
      Effect.mapError(mapApiError(ACCOUNT_KIND, "list")),
    ),
    list: api.accounts.list.pipe(
      Effect.map((accounts) => accounts.map((a) => ({ remoteId: a.id, props: accountConfigFromDto(a) }))),
      Effect.mapError(mapApiError(ACCOUNT_KIND, "list")),
    ),
    read: (id) =>
      api.accounts.list.pipe(
        Effect.map((accounts) => {
          const found = accounts.find((a) => a.id === id);
          return found ? { remoteId: found.id, props: accountConfigFromDto(found) } : null;
        }),
        Effect.mapError(mapApiError(ACCOUNT_KIND, "read", id)),
      ),
    create: () => Effect.fail(readOnly(ACCOUNT_KIND, "create")),
    update: () => Effect.fail(readOnly(ACCOUNT_KIND, "update")),
    delete: () => Effect.fail(readOnly(ACCOUNT_KIND, "delete")),
  };
}

// ── custom properties (create + deprecate; no in-place update) ────────────────

function customPropertyProvider(api: OnboardedApi): ConfigProvider<OnboardedCustomPropertyConfig> {
  const entity = (dto: Parameters<typeof customPropertyConfigFromDto>[0]): RemoteEntity<OnboardedCustomPropertyConfig> => ({
    remoteId: dto.id,
    props: customPropertyConfigFromDto(dto),
  });
  return {
    kind: CUSTOM_PROPERTY_KIND,
    schema: OnboardedCustomPropertyConfigSchema,
    keyOf: (config) => config.path,
    suggestKey: (e) => e.props.path,
    applyKey: (config, key) => ({ ...config, path: key }),
    pathFor: (key) => `custom-properties/${key}.yaml`,
    route: "custom-properties/*.yaml",
    listSummaries: api.customProperties.list.pipe(
      Effect.map((properties) => properties.map((p) => ({ remoteId: p.id, suggestedKey: p.path }))),
      Effect.mapError(mapApiError(CUSTOM_PROPERTY_KIND, "list")),
    ),
    list: api.customProperties.list.pipe(
      Effect.map((properties) => properties.map(entity)),
      Effect.mapError(mapApiError(CUSTOM_PROPERTY_KIND, "list")),
    ),
    read: (id) =>
      api.customProperties.list.pipe(
        Effect.map((properties) => {
          const found = properties.find((p) => p.id === id);
          return found ? entity(found) : null;
        }),
        Effect.mapError(mapApiError(CUSTOM_PROPERTY_KIND, "read", id)),
      ),
    create: (config) =>
      api.customProperties
        .create(customPropertyDtoFromConfig(config))
        .pipe(Effect.map(entity), Effect.mapError(mapApiError(CUSTOM_PROPERTY_KIND, "create", config.path))),
    update: () =>
      Effect.fail(unsupported(CUSTOM_PROPERTY_KIND, "update", "custom properties cannot be updated in place")),
    delete: (id) =>
      api.customProperties.deprecate(id).pipe(Effect.asVoid, Effect.mapError(mapApiError(CUSTOM_PROPERTY_KIND, "delete", id))),
  };
}

// ── forms (full CRUD) ─────────────────────────────────────────────────────────

function formProvider(api: OnboardedApi): ConfigProvider<OnboardedFormConfig> {
  const entity = (dto: Parameters<typeof formConfigFromDto>[0]): RemoteEntity<OnboardedFormConfig> => ({
    remoteId: dto.uid,
    props: formConfigFromDto(dto),
  });
  return {
    kind: FORM_KIND,
    schema: OnboardedFormConfigSchema,
    keyOf: (config) => config.id,
    suggestKey: (e) => slugify(e.props.name),
    applyKey: (config, key) => ({ ...config, id: key }),
    pathFor: (key) => `forms/${key}.yaml`,
    route: "forms/*.yaml",
    listSummaries: api.forms.list.pipe(
      Effect.map((forms) =>
        forms.map((f) => ({ remoteId: f.uid, suggestedKey: slugify(f.name), summary: { name: f.name } })),
      ),
      Effect.mapError(mapApiError(FORM_KIND, "list")),
    ),
    list: api.forms.list.pipe(
      Effect.map((forms) => forms.map(entity)),
      Effect.mapError(mapApiError(FORM_KIND, "list")),
    ),
    read: (uid) =>
      api.forms.get(uid).pipe(
        Effect.map((form) => (form ? entity(form) : null)),
        Effect.mapError(mapApiError(FORM_KIND, "read", uid)),
      ),
    create: (config) =>
      api.forms
        .create(formCreateDtoFromConfig(config))
        .pipe(Effect.map(entity), Effect.mapError(mapApiError(FORM_KIND, "create", config.id))),
    update: (uid, config) =>
      api.forms
        .update(uid, formUpdateDtoFromConfig(config))
        .pipe(Effect.map(entity), Effect.mapError(mapApiError(FORM_KIND, "update", uid))),
    delete: (uid) => api.forms.delete(uid).pipe(Effect.mapError(mapApiError(FORM_KIND, "delete", uid))),
  };
}

// ── policies (full CRUD; resolves form slugs ↔ uids) ──────────────────────────

function policyProvider(api: OnboardedApi, state: ConfigStateStore): ConfigProvider<OnboardedPolicyConfig> {
  return {
    kind: POLICY_KIND,
    schema: OnboardedPolicyConfigSchema,
    keyOf: (config) => config.id,
    suggestKey: (e) => slugify(e.props.name),
    applyKey: (config, key) => ({ ...config, id: key }),
    pathFor: (key) => `policies/${key}.yaml`,
    route: "policies/*.yaml",
    dependsOn: (config) => (config.forms ?? []).map((slug) => ({ kind: FORM_KIND, key: slug })),
    listSummaries: api.policies.list.pipe(
      Effect.map((policies) => policies.map((p) => ({ remoteId: p.id, suggestedKey: slugify(p.name) }))),
      Effect.mapError(mapApiError(POLICY_KIND, "list")),
    ),
    list: Effect.gen(function* () {
      const snapshot = yield* state.read.pipe(Effect.mapError(lockfileError(POLICY_KIND, "list")));
      const resolve = resolverFromState(snapshot);
      const policies = yield* api.policies.list.pipe(Effect.mapError(mapApiError(POLICY_KIND, "list")));
      return policies.map((p) => ({ remoteId: p.id, props: policyConfigFromDto(p, resolve) }));
    }),
    read: (id) =>
      Effect.gen(function* () {
        const snapshot = yield* state.read.pipe(Effect.mapError(lockfileError(POLICY_KIND, "read", id)));
        const resolve = resolverFromState(snapshot);
        const policy = yield* api.policies.get(id).pipe(Effect.mapError(mapApiError(POLICY_KIND, "read", id)));
        return policy ? { remoteId: policy.id, props: policyConfigFromDto(policy, resolve) } : null;
      }),
    create: (config, context) =>
      api.policies
        .create(policyCreateDtoFromConfig(config, writeResolver(context)))
        .pipe(
          Effect.map((policy) => ({ remoteId: policy.id, props: config })),
          Effect.mapError(mapApiError(POLICY_KIND, "create", config.id)),
        ),
    update: (id, config, context) =>
      api.policies
        .update(id, policyUpdateDtoFromConfig(config, writeResolver(context)))
        .pipe(
          Effect.map((policy) => ({ remoteId: policy.id, props: config })),
          Effect.mapError(mapApiError(POLICY_KIND, "update", id)),
        ),
    delete: (id) => api.policies.delete(id).pipe(Effect.mapError(mapApiError(POLICY_KIND, "delete", id))),
  };
}

// ── automations (create via import; no in-place graph update) ─────────────────

function automationProvider(api: OnboardedApi, state: ConfigStateStore): ConfigProvider<OnboardedAutomationConfig> {
  return {
    kind: AUTOMATION_KIND,
    schema: OnboardedAutomationConfigSchema,
    keyOf: (config) => config.id,
    suggestKey: (e) => slugify(e.props.name),
    applyKey: (config, key) => ({ ...config, id: key }),
    pathFor: (key) => `automations/${key}.yaml`,
    route: "automations/*.yaml",
    dependsOn: (config) => automationFormRefSlugs(config).map((slug) => ({ kind: FORM_KIND, key: slug })),
    listSummaries: api.automations.list.pipe(
      Effect.map((automations) => automations.map((a) => ({ remoteId: a.id, suggestedKey: slugify(a.name) }))),
      Effect.mapError(mapApiError(AUTOMATION_KIND, "list")),
    ),
    list: Effect.gen(function* () {
      const resolve = resolverFromState(yield* state.read.pipe(Effect.mapError(lockfileError(AUTOMATION_KIND, "list"))));
      const summaries = yield* api.automations.list.pipe(Effect.mapError(mapApiError(AUTOMATION_KIND, "list")));
      const entities: RemoteEntity<OnboardedAutomationConfig>[] = [];
      for (const summary of summaries) {
        const detail = yield* api.automations.get(summary.id).pipe(Effect.mapError(mapApiError(AUTOMATION_KIND, "read", summary.id)));
        if (detail) entities.push({ remoteId: detail.id, props: automationConfigFromDto(detail, resolve) });
      }
      return entities;
    }),
    read: (id) =>
      Effect.gen(function* () {
        const resolve = resolverFromState(yield* state.read.pipe(Effect.mapError(lockfileError(AUTOMATION_KIND, "read", id))));
        const detail = yield* api.automations.get(id).pipe(Effect.mapError(mapApiError(AUTOMATION_KIND, "read", id)));
        return detail ? { remoteId: detail.id, props: automationConfigFromDto(detail, resolve) } : null;
      }),
    create: (config, context) =>
      api.automations
        .import(automationImportDtoFromConfig(config, writeResolver(context)))
        .pipe(
          Effect.map((detail) => ({ remoteId: detail.id, props: config })),
          Effect.mapError(mapApiError(AUTOMATION_KIND, "create", config.id)),
        ),
    update: () =>
      Effect.fail(unsupported(AUTOMATION_KIND, "update", "automations cannot be updated in place (re-import)")),
    delete: (id) => api.automations.delete(id).pipe(Effect.mapError(mapApiError(AUTOMATION_KIND, "delete", id))),
  };
}

/** YAML codec reusing the Schema IDE document codec, so files match the rest of the project. */
export const onboardedYamlCodec: ConfigCodec = {
  extension: "yaml",
  parse: (text) => {
    const result = Schema.decodeUnknownResult(parseYaml())(text);
    if (Result.isFailure(result)) throw new Error("Failed to parse YAML document");
    return result.success;
  },
  stringify: (value) => stringifyDocument(value, "yaml"),
};

export interface OnboardedConfigDeployOptions {
  readonly store: ArtifactStore;
  /** Defaults to a fresh in-memory mock OnboardedApi. */
  readonly api?: OnboardedApi | undefined;
  readonly lockfilePath?: string | undefined;
  readonly projectId?: string | undefined;
}

/** Wire all five Onboarded providers into the engine with the YAML codec + committed lockfile. */
export function makeOnboardedConfigDeploy(options: OnboardedConfigDeployOptions): ConfigDeploy {
  const api = options.api ?? makeMockOnboardedApi();
  const state = artifactConfigStateStore(options.store, {
    path: options.lockfilePath ?? "config.lock.json",
    projectId: options.projectId,
  });
  return makeConfigDeploy({
    store: options.store,
    providers: [
      accountProvider(api),
      customPropertyProvider(api),
      formProvider(api),
      policyProvider(api, state),
      automationProvider(api, state),
    ],
    codec: onboardedYamlCodec,
    state,
    projectId: options.projectId,
  });
}
