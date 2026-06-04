import type { ArtifactStore } from "@schematics/artifacts";
import {
  artifactConfigStateStore,
  defineResource,
  makeConfigDeploy,
  makeRateLimiter,
  throttleProvider,
  ProviderError,
  type ConfigCodec,
  type ConfigDeploy,
  type ConfigProvider,
  type ConfigState,
  type ConfigStateStore,
  type ProviderOperation,
  type RemoteEntity,
} from "@schematics/alchemy";
import { parseYaml, stringifyDocument } from "@schematics/core";
import { type Duration, Effect, Result, Schema } from "effect";
import {
  accountConfigFromDto,
  automationConfigFromDto,
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
 * Layer 2 — wires the five Onboarded entity providers into the alchemy
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
  (kind: string, operation: ProviderOperation, key?: string) => (): ProviderError =>
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

/** A write-direction RefResolver from reconcile's `resolveRemoteId` (slug → remote id). */
const writeResolver = (
  resolveRemoteId: (kind: string, key: string) => string | null,
): RefResolver => ({
  toRemoteId: resolveRemoteId,
  toKey: () => null,
});

// ── account (read-only) ─────────────────────────────────────────────────────

function accountProvider(api: OnboardedApi): ConfigProvider<OnboardedAccountConfig> {
  const entity = (
    dto: Parameters<typeof accountConfigFromDto>[0],
  ): RemoteEntity<OnboardedAccountConfig> => ({
    remoteId: dto.id,
    props: accountConfigFromDto(dto),
  });
  return defineResource<OnboardedAccountConfig>({
    kind: ACCOUNT_KIND,
    schema: OnboardedAccountConfigSchema,
    route: "account.yaml",
    path: () => "account.yaml",
    keyField: "id",
    list: api.accounts.list.pipe(
      Effect.map((accounts) => accounts.map(entity)),
      Effect.mapError(mapApiError(ACCOUNT_KIND, "list")),
    ),
    read: (id) =>
      api.accounts.list.pipe(
        Effect.map((accounts) => {
          const found = accounts.find((a) => a.id === id);
          return found ? entity(found) : null;
        }),
        Effect.mapError(mapApiError(ACCOUNT_KIND, "read", id)),
      ),
    reconcile: ({ remoteId }) =>
      Effect.fail(readOnly(ACCOUNT_KIND, remoteId === null ? "create" : "update")),
    // The account container can't be deleted remotely; destroy just drops it from the lockfile.
    remove: () => Effect.void,
  });
}

// ── custom properties (create + deprecate; no in-place update) ────────────────

function customPropertyProvider(api: OnboardedApi): ConfigProvider<OnboardedCustomPropertyConfig> {
  const entity = (
    dto: Parameters<typeof customPropertyConfigFromDto>[0],
  ): RemoteEntity<OnboardedCustomPropertyConfig> => ({
    remoteId: dto.id,
    props: customPropertyConfigFromDto(dto),
  });
  return defineResource<OnboardedCustomPropertyConfig>({
    kind: CUSTOM_PROPERTY_KIND,
    schema: OnboardedCustomPropertyConfigSchema,
    route: "custom-properties/*.yaml",
    path: (key) => `custom-properties/${key}.yaml`,
    keyField: "path",
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
    reconcile: ({ news, remoteId }) =>
      remoteId === null
        ? api.customProperties
            .create(customPropertyDtoFromConfig(news))
            .pipe(
              Effect.map(entity),
              Effect.mapError(mapApiError(CUSTOM_PROPERTY_KIND, "create", news.path)),
            )
        : Effect.fail(
            unsupported(
              CUSTOM_PROPERTY_KIND,
              "update",
              "custom properties cannot be updated in place",
            ),
          ),
    remove: (id) =>
      api.customProperties
        .deprecate(id)
        .pipe(Effect.asVoid, Effect.mapError(mapApiError(CUSTOM_PROPERTY_KIND, "delete", id))),
  });
}

// ── forms (full CRUD) ─────────────────────────────────────────────────────────

function formProvider(api: OnboardedApi): ConfigProvider<OnboardedFormConfig> {
  const entity = (
    dto: Parameters<typeof formConfigFromDto>[0],
  ): RemoteEntity<OnboardedFormConfig> => ({
    remoteId: dto.uid,
    props: formConfigFromDto(dto),
  });
  // Expressed with the ergonomic builder: one `reconcile` (create+update) +
  // `keyField` instead of separate create/update + keyOf/applyKey/suggestKey.
  return defineResource<OnboardedFormConfig>({
    kind: FORM_KIND,
    schema: OnboardedFormConfigSchema,
    route: "forms/*.yaml",
    path: (key) => `forms/${key}.yaml`,
    keyField: "id",
    slug: (e) => slugify(e.props.name),
    list: api.forms.list.pipe(
      Effect.map((forms) => forms.map(entity)),
      Effect.mapError(mapApiError(FORM_KIND, "list")),
    ),
    read: (uid) =>
      api.forms.get(uid).pipe(
        Effect.map((form) => (form ? entity(form) : null)),
        Effect.mapError(mapApiError(FORM_KIND, "read", uid)),
      ),
    reconcile: ({ news, remoteId }) =>
      (remoteId === null
        ? api.forms.create(formCreateDtoFromConfig(news))
        : api.forms.update(remoteId, formUpdateDtoFromConfig(news))
      ).pipe(
        Effect.map(entity),
        Effect.mapError(
          mapApiError(FORM_KIND, remoteId === null ? "create" : "update", remoteId ?? news.id),
        ),
      ),
    remove: (uid) =>
      api.forms.delete(uid).pipe(Effect.mapError(mapApiError(FORM_KIND, "delete", uid))),
  });
}

// ── policies (full CRUD; resolves form slugs ↔ uids) ──────────────────────────

function policyProvider(
  api: OnboardedApi,
  state: ConfigStateStore,
): ConfigProvider<OnboardedPolicyConfig> {
  return defineResource<OnboardedPolicyConfig>({
    kind: POLICY_KIND,
    schema: OnboardedPolicyConfigSchema,
    route: "policies/*.yaml",
    path: (key) => `policies/${key}.yaml`,
    keyField: "id",
    slug: (e) => slugify(e.props.name),
    // read side resolves form uids → slugs via a lockfile snapshot
    list: Effect.gen(function* () {
      const resolve = resolverFromState(
        yield* state.read.pipe(Effect.mapError(lockfileError(POLICY_KIND, "list"))),
      );
      const policies = yield* api.policies.list.pipe(
        Effect.mapError(mapApiError(POLICY_KIND, "list")),
      );
      return policies.map((p) => ({ remoteId: p.id, props: policyConfigFromDto(p, resolve) }));
    }),
    read: (id) =>
      Effect.gen(function* () {
        const resolve = resolverFromState(
          yield* state.read.pipe(Effect.mapError(lockfileError(POLICY_KIND, "read", id))),
        );
        const policy = yield* api.policies
          .get(id)
          .pipe(Effect.mapError(mapApiError(POLICY_KIND, "read", id)));
        return policy ? { remoteId: policy.id, props: policyConfigFromDto(policy, resolve) } : null;
      }),
    // write side resolves form slugs → uids via the apply context
    reconcile: ({ news, remoteId, resolveRemoteId }) =>
      (remoteId === null
        ? api.policies.create(policyCreateDtoFromConfig(news, writeResolver(resolveRemoteId)))
        : api.policies.update(
            remoteId,
            policyUpdateDtoFromConfig(news, writeResolver(resolveRemoteId)),
          )
      ).pipe(
        Effect.map((policy) => ({ remoteId: policy.id, props: news })),
        Effect.mapError(
          mapApiError(POLICY_KIND, remoteId === null ? "create" : "update", remoteId ?? news.id),
        ),
      ),
    remove: (id) =>
      api.policies.delete(id).pipe(Effect.mapError(mapApiError(POLICY_KIND, "delete", id))),
  });
}

// ── automations (create via import; no in-place graph update) ─────────────────

function automationProvider(
  api: OnboardedApi,
  state: ConfigStateStore,
): ConfigProvider<OnboardedAutomationConfig> {
  return defineResource<OnboardedAutomationConfig>({
    kind: AUTOMATION_KIND,
    schema: OnboardedAutomationConfigSchema,
    route: "automations/*.yaml",
    path: (key) => `automations/${key}.yaml`,
    keyField: "id",
    slug: (e) => slugify(e.props.name),
    list: Effect.gen(function* () {
      const resolve = resolverFromState(
        yield* state.read.pipe(Effect.mapError(lockfileError(AUTOMATION_KIND, "list"))),
      );
      const summaries = yield* api.automations.list.pipe(
        Effect.mapError(mapApiError(AUTOMATION_KIND, "list")),
      );
      const entities: RemoteEntity<OnboardedAutomationConfig>[] = [];
      for (const summary of summaries) {
        const detail = yield* api.automations
          .get(summary.id)
          .pipe(Effect.mapError(mapApiError(AUTOMATION_KIND, "read", summary.id)));
        if (detail)
          entities.push({ remoteId: detail.id, props: automationConfigFromDto(detail, resolve) });
      }
      return entities;
    }),
    read: (id) =>
      Effect.gen(function* () {
        const resolve = resolverFromState(
          yield* state.read.pipe(Effect.mapError(lockfileError(AUTOMATION_KIND, "read", id))),
        );
        const detail = yield* api.automations
          .get(id)
          .pipe(Effect.mapError(mapApiError(AUTOMATION_KIND, "read", id)));
        return detail
          ? { remoteId: detail.id, props: automationConfigFromDto(detail, resolve) }
          : null;
      }),
    reconcile: ({ news, remoteId, resolveRemoteId }) =>
      remoteId === null
        ? api.automations
            .import(automationImportDtoFromConfig(news, writeResolver(resolveRemoteId)))
            .pipe(
              Effect.map((detail) => ({ remoteId: detail.id, props: news })),
              Effect.mapError(mapApiError(AUTOMATION_KIND, "create", news.id)),
            )
        : Effect.fail(
            unsupported(
              AUTOMATION_KIND,
              "update",
              "automations cannot be updated in place (re-import)",
            ),
          ),
    remove: (id) =>
      api.automations.delete(id).pipe(Effect.mapError(mapApiError(AUTOMATION_KIND, "delete", id))),
  });
}

/** YAML codec reusing the Schematics document codec, so files match the rest of the project. */
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
  /**
   * Global API throttle shared across pull and push. When set, one serial
   * min-spacing limiter wraps every provider call. Omit to disable (the default);
   * pass `{}` for one call per second, or `{ interval }` to tune the spacing.
   */
  readonly throttle?: { readonly interval?: Duration.Input } | undefined;
}

/** Wire all five Onboarded providers into the engine with the YAML codec + committed lockfile. */
export function makeOnboardedConfigDeploy(options: OnboardedConfigDeployOptions): ConfigDeploy {
  const api = options.api ?? makeMockOnboardedApi();
  const state = artifactConfigStateStore(options.store, {
    path: options.lockfilePath ?? "config.lock.json",
    projectId: options.projectId,
  });
  // One shared limiter for the whole deploy, so pull and push never exceed the
  // same rate. Wrapping each provider keeps the throttle transparent to the engine.
  const limiter = options.throttle
    ? makeRateLimiter({ interval: options.throttle.interval ?? "1 second" })
    : null;
  const providers = [
    accountProvider(api),
    customPropertyProvider(api),
    formProvider(api),
    policyProvider(api, state),
    automationProvider(api, state),
  ].map((provider) => (limiter ? throttleProvider(provider, limiter) : provider));
  return makeConfigDeploy({
    store: options.store,
    providers,
    codec: onboardedYamlCodec,
    state,
    projectId: options.projectId,
  });
}
