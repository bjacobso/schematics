import { Effect, Result, Schema, SchemaIssue } from "effect";
import {
  AccountDtoSchema,
  AutomationDetailDtoSchema,
  AutomationDtoSchema,
  CustomPropertyDtoSchema,
  FormDtoSchema,
  PolicyDtoSchema,
  type AccountDto,
  type AutomationDetailDto,
  type AutomationDto,
  type CustomPropertyDto,
  type FormDto,
  type PolicyDto,
} from "../domain";
import { OnboardedApiError, type OnboardedApi, type OnboardedApiCall } from "../mock/onboarded-api";

/**
 * REST route templates for the Onboarded internal HttpApi. Defaults are
 * best-effort; override per-deployment if the live API differs. `:id` / `:uid`
 * are substituted at call time.
 */
export interface OnboardedHttpRoutes {
  readonly accounts: string;
  readonly customProperties: string;
  readonly customPropertyDeprecate: string;
  readonly forms: string;
  readonly form: string;
  readonly policies: string;
  readonly policy: string;
  readonly automations: string;
  readonly automation: string;
  readonly automationImport: string;
}

export const DEFAULT_ONBOARDED_HTTP_ROUTES: OnboardedHttpRoutes = {
  accounts: "/api/v1/accounts",
  customProperties: "/api/v1/custom_properties",
  customPropertyDeprecate: "/api/v1/custom_properties/:id/deprecate",
  forms: "/api/v1/forms",
  form: "/api/v1/forms/:uid",
  policies: "/api/v1/policies",
  policy: "/api/v1/policies/:id",
  automations: "/api/v1/automations",
  automation: "/api/v1/automations/:id",
  automationImport: "/api/v1/automations/import",
};

export interface OnboardedHttpApiOptions {
  readonly baseUrl: string;
  /** Bearer token. Supplied server-side from the connection secret-ref. */
  readonly token: string;
  /** Injectable fetch (tests / non-global runtimes). Defaults to global fetch. */
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly routes?: Partial<OnboardedHttpRoutes> | undefined;
}

const formatIssue = SchemaIssue.makeFormatterDefault();

/**
 * Live {@link OnboardedApi} over the Onboarded internal HttpApi. The five
 * config-deploy providers consume this identically to {@link makeMockOnboardedApi};
 * pass it to {@link makeOnboardedDeployService}'s `apiFactory` once a connection
 * is established.
 *
 * NOTE: route templates are best-effort — verify {@link DEFAULT_ONBOARDED_HTTP_ROUTES}
 * against the live API surface before production use.
 */
export function makeOnboardedHttpApi(options: OnboardedHttpApiOptions): OnboardedApi {
  const base = options.baseUrl.replace(/\/$/, "");
  const routes = { ...DEFAULT_ONBOARDED_HTTP_ROUTES, ...options.routes };
  const doFetch = options.fetch ?? globalThis.fetch;
  const calls: OnboardedApiCall[] = [];

  const record = (group: string, operation: string, id?: string): void => {
    calls.push(id === undefined ? { group, operation } : { group, operation, id });
  };

  const fetchJson = (
    method: string,
    path: string,
    group: string,
    operation: string,
    id: string | undefined,
    body?: unknown,
  ): Effect.Effect<unknown, OnboardedApiError> =>
    Effect.tryPromise({
      try: async () => {
        record(group, operation, id);
        const init: RequestInit = {
          method,
          headers: {
            authorization: `Bearer ${options.token}`,
            "content-type": "application/json",
            accept: "application/json",
          },
        };
        if (body !== undefined) init.body = JSON.stringify(body);
        const response = await doFetch(`${base}${path}`, init);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        if (response.status === 204) return null;
        const text = await response.text();
        return text ? JSON.parse(text) : null;
      },
      catch: (cause) =>
        new OnboardedApiError({
          group,
          operation,
          ...(id === undefined ? {} : { id }),
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    });

  const decode = <A>(
    schema: unknown,
    value: unknown,
    group: string,
    operation: string,
    id?: string,
  ): Effect.Effect<A, OnboardedApiError> => {
    const result = Schema.decodeUnknownResult(schema as never)(value);
    if (Result.isFailure(result)) {
      return Effect.fail(
        new OnboardedApiError({
          group,
          operation,
          ...(id === undefined ? {} : { id }),
          message: `Response failed to decode: ${formatIssue(result.failure)}`,
        }),
      );
    }
    return Effect.succeed(result.success as A);
  };

  const fill = (template: string, params: Record<string, string>): string =>
    template.replace(/:(\w+)/g, (_, key: string) => encodeURIComponent(params[key] ?? ""));

  return {
    calls,

    accounts: {
      list: fetchJson("GET", routes.accounts, "accounts", "list", undefined).pipe(
        Effect.flatMap((json) =>
          decode<readonly AccountDto[]>(Schema.Array(AccountDtoSchema), json, "accounts", "list"),
        ),
      ),
    },

    customProperties: {
      list: fetchJson("GET", routes.customProperties, "custom_properties", "list", undefined).pipe(
        Effect.flatMap((json) =>
          decode<readonly CustomPropertyDto[]>(
            Schema.Array(CustomPropertyDtoSchema),
            json,
            "custom_properties",
            "list",
          ),
        ),
      ),
      create: (property) =>
        fetchJson(
          "POST",
          routes.customProperties,
          "custom_properties",
          "create",
          property.id,
          property,
        ).pipe(
          Effect.flatMap((json) =>
            decode<CustomPropertyDto>(
              CustomPropertyDtoSchema,
              json,
              "custom_properties",
              "create",
              property.id,
            ),
          ),
        ),
      deprecate: (id) =>
        fetchJson(
          "POST",
          fill(routes.customPropertyDeprecate, { id }),
          "custom_properties",
          "deprecate",
          id,
        ).pipe(
          Effect.flatMap((json) =>
            decode<CustomPropertyDto>(
              CustomPropertyDtoSchema,
              json,
              "custom_properties",
              "deprecate",
              id,
            ),
          ),
        ),
    },

    forms: {
      list: fetchJson("GET", routes.forms, "forms", "list", undefined).pipe(
        Effect.flatMap((json) =>
          decode<readonly FormDto[]>(Schema.Array(FormDtoSchema), json, "forms", "list"),
        ),
      ),
      get: (uid) =>
        fetchJson("GET", fill(routes.form, { uid }), "forms", "get", uid).pipe(
          Effect.flatMap((json) =>
            json === null
              ? Effect.succeed(null)
              : decode<FormDto>(FormDtoSchema, json, "forms", "get", uid),
          ),
        ),
      create: (body) =>
        fetchJson("POST", routes.forms, "forms", "create", undefined, body).pipe(
          Effect.flatMap((json) => decode<FormDto>(FormDtoSchema, json, "forms", "create")),
        ),
      update: (uid, body) =>
        fetchJson("PATCH", fill(routes.form, { uid }), "forms", "update", uid, body).pipe(
          Effect.flatMap((json) => decode<FormDto>(FormDtoSchema, json, "forms", "update", uid)),
        ),
      delete: (uid) =>
        fetchJson("DELETE", fill(routes.form, { uid }), "forms", "delete", uid).pipe(Effect.asVoid),
    },

    policies: {
      list: fetchJson("GET", routes.policies, "policies", "list", undefined).pipe(
        Effect.flatMap((json) =>
          decode<readonly PolicyDto[]>(Schema.Array(PolicyDtoSchema), json, "policies", "list"),
        ),
      ),
      get: (id) =>
        fetchJson("GET", fill(routes.policy, { id }), "policies", "get", id).pipe(
          Effect.flatMap((json) =>
            json === null
              ? Effect.succeed(null)
              : decode<PolicyDto>(PolicyDtoSchema, json, "policies", "get", id),
          ),
        ),
      create: (body) =>
        fetchJson("POST", routes.policies, "policies", "create", undefined, body).pipe(
          Effect.flatMap((json) => decode<PolicyDto>(PolicyDtoSchema, json, "policies", "create")),
        ),
      update: (id, body) =>
        fetchJson("PATCH", fill(routes.policy, { id }), "policies", "update", id, body).pipe(
          Effect.flatMap((json) =>
            decode<PolicyDto>(PolicyDtoSchema, json, "policies", "update", id),
          ),
        ),
      delete: (id) =>
        fetchJson("DELETE", fill(routes.policy, { id }), "policies", "delete", id).pipe(
          Effect.asVoid,
        ),
    },

    automations: {
      list: fetchJson("GET", routes.automations, "automations", "list", undefined).pipe(
        Effect.flatMap((json) =>
          decode<readonly AutomationDto[]>(
            Schema.Array(AutomationDtoSchema),
            json,
            "automations",
            "list",
          ),
        ),
      ),
      get: (id) =>
        fetchJson("GET", fill(routes.automation, { id }), "automations", "get", id).pipe(
          Effect.flatMap((json) =>
            json === null
              ? Effect.succeed(null)
              : decode<AutomationDetailDto>(
                  AutomationDetailDtoSchema,
                  json,
                  "automations",
                  "get",
                  id,
                ),
          ),
        ),
      import: (body) =>
        fetchJson("POST", routes.automationImport, "automations", "import", undefined, body).pipe(
          Effect.flatMap((json) =>
            decode<AutomationDetailDto>(AutomationDetailDtoSchema, json, "automations", "import"),
          ),
        ),
      delete: (id) =>
        fetchJson("DELETE", fill(routes.automation, { id }), "automations", "delete", id).pipe(
          Effect.asVoid,
        ),
    },
  };
}
