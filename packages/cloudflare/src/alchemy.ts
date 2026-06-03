import * as Cloudflare from "alchemy/Cloudflare";
import { Stack } from "alchemy/Stack";
import { Effect } from "effect";

export const schemaIdeWorkspaceObjectClassName = "SchemaIdeWorkspaceObject";
export const schemaIdeWorkspaceBindingName = "SCHEMA_IDE_WORKSPACES";

/** Worker binding name for the Cloudflare Artifacts (Git) namespace. */
export const schemaIdeArtifactsBindingName = "SCHEMA_IDE_ARTIFACTS";

/** Prefix for the per-stage Artifacts namespace name. */
const artifactsNamespacePrefix = "schema-ide-workspaces";

export interface SchemaIdeArtifactsNamespaceOptions {
  /**
   * Explicit Cloudflare Artifacts namespace name (3–63 lowercase alphanumerics
   * and hyphens). Omit to derive a per-stage name like `schema-ide-workspaces-pr-20`.
   */
  readonly namespace?: string | undefined;
}

/** Coerce any string into a valid Artifacts namespace (lowercase, hyphenated, 3–63). */
function toArtifactsNamespace(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  return cleaned.length >= 3 ? cleaned : `${cleaned}-ns`;
}

/**
 * Declare the Cloudflare Artifacts (Git-for-agents) namespace binding. Wiring
 * it into a Worker's `bindings` gives `env.SCHEMA_IDE_ARTIFACTS` a runtime
 * client (`create`/`get`/`delete`/...) for managing per-workspace Git repos.
 *
 * The namespace is **per-stage** by default (e.g. `schema-ide-workspaces-pr-20`,
 * `schema-ide-workspaces-prod`) so each deploy stage gets its own isolated set
 * of workspace repos — mirroring how the Api/Playground workers are named per
 * stage. Alchemy's own default (lowercasing the binding name) is both invalid
 * (underscores) and not stage-scoped, so the name is built explicitly here.
 */
export function makeSchemaIdeArtifactsNamespace(options: SchemaIdeArtifactsNamespaceOptions = {}) {
  if (options.namespace) {
    return Cloudflare.Artifacts(schemaIdeArtifactsBindingName, {
      namespace: toArtifactsNamespace(options.namespace),
    });
  }
  return Effect.flatMap(Stack, (stack) =>
    Cloudflare.Artifacts(schemaIdeArtifactsBindingName, {
      namespace: toArtifactsNamespace(`${artifactsNamespacePrefix}-${stack.stage}`),
    }),
  );
}

export interface SchemaIdeWorkspaceNamespaceOptions {
  readonly name?: string | undefined;
  readonly className?: string | undefined;
}

export interface SchemaIdeApiWorkerOptions<
  Bindings extends Cloudflare.WorkerBindingProps = {},
> extends Omit<Cloudflare.WorkerProps<Bindings>, "main" | "env" | "bindings"> {
  readonly main: string;
  readonly env?: NonNullable<Cloudflare.WorkerProps["env"]>;
  readonly bindings?: Bindings;
  readonly workspaceBindingName?: string | undefined;
  readonly workspaceNamespace?: Cloudflare.WorkerBindingProps[string];
}

export function makeSchemaIdeWorkspaceNamespace(options: SchemaIdeWorkspaceNamespaceOptions = {}) {
  return Cloudflare.DurableObjectNamespace(options.name ?? schemaIdeWorkspaceObjectClassName, {
    className: options.className ?? schemaIdeWorkspaceObjectClassName,
  });
}

export function makeSchemaIdeApiWorker(name: string, options: SchemaIdeApiWorkerOptions) {
  const {
    bindings: providedBindings,
    env,
    main,
    workspaceBindingName,
    workspaceNamespace,
    ...workerOptions
  } = options;
  const bindings = {
    ...providedBindings,
    [workspaceBindingName ?? schemaIdeWorkspaceBindingName]:
      workspaceNamespace ?? makeSchemaIdeWorkspaceNamespace(),
  } satisfies Cloudflare.WorkerBindingProps;
  const props = {
    ...workerOptions,
    main,
    bindings,
    ...(env ? { env } : {}),
  };
  return Cloudflare.Worker(name, props);
}
