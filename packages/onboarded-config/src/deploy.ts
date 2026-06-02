import type { ArtifactStore } from "@schema-ide/artifacts";
import {
  artifactConfigStateStore,
  makeConfigDeploy,
  ProviderError,
  type ConfigCodec,
  type ConfigDeploy,
  type ConfigProvider,
  type ProviderOperation,
  type RemoteEntity,
} from "@schema-ide/config-deploy";
import { parseYaml, stringifyDocument } from "@schema-ide/core";
import { Data, Effect, Result, Schema } from "effect";
import { OnboardedFormConfigSchema, type OnboardedFormConfig } from "./forms";

/**
 * Layer 2 — the Onboarded implementation of the abstract config-deploy engine.
 *
 * The engine talks to a small Effect *port* per entity. A real adapter over the
 * Onboarded `InternalApi` (writes are internal-only) — or a recording mock in
 * tests — implements the port. The Onboarded form `uid` is the opaque remote id;
 * the human slug lives only in the file + lockfile (the API has no slug field).
 */

/** Error raised by an Onboarded API port. Mapped to {@link ProviderError} by the provider. */
export class OnboardedApiError extends Data.TaggedError("OnboardedApiError")<{
  readonly resource: string;
  readonly operation: ProviderOperation;
  readonly key?: string | undefined;
  readonly message: string;
}> {}

/** A form as the API sees it: opaque `uid` + the config-shaped value. */
export interface OnboardedFormRecord {
  readonly uid: string;
  readonly form: OnboardedFormConfig;
}

/**
 * CRUD port for account-owned forms (the managed scope). A real adapter should
 * stamp/filter the reserved config-as-code tag so `listForms` only returns
 * config-managed forms.
 */
export interface OnboardedFormsApi {
  readonly listForms: Effect.Effect<readonly OnboardedFormRecord[], OnboardedApiError>;
  readonly getForm: (uid: string) => Effect.Effect<OnboardedFormRecord | null, OnboardedApiError>;
  readonly createForm: (form: OnboardedFormConfig) => Effect.Effect<OnboardedFormRecord, OnboardedApiError>;
  readonly updateForm: (
    uid: string,
    form: OnboardedFormConfig,
  ) => Effect.Effect<OnboardedFormRecord, OnboardedApiError>;
  readonly deleteForm: (uid: string) => Effect.Effect<void, OnboardedApiError>;
}

/** Reserved tag a real adapter uses to mark/scope config-managed forms. */
export const ONBOARDED_MANAGED_TAG = "_managed_by_config_as_code";

const toProviderError =
  (operation: ProviderOperation, key: string | undefined) =>
  (error: OnboardedApiError): ProviderError =>
    new ProviderError({ kind: "OnboardedForm", operation, key, message: error.message });

const toEntity = (record: OnboardedFormRecord): RemoteEntity<OnboardedFormConfig> => ({
  remoteId: record.uid,
  props: record.form,
});

/** Derive a stable, file-friendly slug from a form name. */
export function slugifyFormName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "form";
}

/**
 * Forms provider. File identity is the form `id` (its slug); the remote id is the
 * opaque `uid`. New remote forms get `slugify(name)`; existing ones keep their
 * lockfile slug across server-side renames (the engine pins slug → uid).
 */
export function makeOnboardedFormProvider(api: OnboardedFormsApi): ConfigProvider<OnboardedFormConfig> {
  return {
    kind: "OnboardedForm",
    schema: OnboardedFormConfigSchema,
    keyOf: (form) => form.id,
    applyKey: (form, key) => ({ ...form, id: key }),
    suggestKey: (entity) => slugifyFormName(entity.props.name),
    pathFor: (key) => `forms/${key}.yaml`,
    route: "forms/*.yaml",
    list: api.listForms.pipe(
      Effect.map((records) => records.map(toEntity)),
      Effect.mapError(toProviderError("list", undefined)),
    ),
    read: (uid) =>
      api.getForm(uid).pipe(
        Effect.map((record) => (record ? toEntity(record) : null)),
        Effect.mapError(toProviderError("read", uid)),
      ),
    create: (form) => api.createForm(form).pipe(Effect.map(toEntity), Effect.mapError(toProviderError("create", form.id))),
    update: (uid, form) => api.updateForm(uid, form).pipe(Effect.map(toEntity), Effect.mapError(toProviderError("update", uid))),
    delete: (uid) => api.deleteForm(uid).pipe(Effect.mapError(toProviderError("delete", uid))),
  };
}

/** YAML codec reusing the Schema IDE document codec, so files match the rest of the project. */
export const onboardedYamlCodec: ConfigCodec = {
  extension: "yaml",
  parse: (text) => {
    const result = Schema.decodeUnknownResult(parseYaml())(text);
    if (Result.isFailure(result)) {
      throw new Error("Failed to parse YAML document");
    }
    return result.success;
  },
  stringify: (value) => stringifyDocument(value, "yaml"),
};

export interface OnboardedConfigDeployApis {
  readonly forms: OnboardedFormsApi;
}

export interface OnboardedConfigDeployOptions {
  readonly store: ArtifactStore;
  readonly apis: OnboardedConfigDeployApis;
  /** Lockfile path in the working tree. Defaults to `config.lock.json`. */
  readonly lockfilePath?: string | undefined;
  readonly projectId?: string | undefined;
}

/** Wire the Onboarded providers into the abstract engine with the YAML codec and a committed lockfile. */
export function makeOnboardedConfigDeploy(options: OnboardedConfigDeployOptions): ConfigDeploy {
  return makeConfigDeploy({
    store: options.store,
    providers: [makeOnboardedFormProvider(options.apis.forms)],
    codec: onboardedYamlCodec,
    state: artifactConfigStateStore(options.store, {
      path: options.lockfilePath ?? "config.lock.json",
      projectId: options.projectId,
    }),
    projectId: options.projectId,
  });
}
