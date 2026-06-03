import * as Cloudflare from "alchemy/Cloudflare";

export const schemaIdeWorkspaceObjectClassName = "SchemaIdeWorkspaceObject";
export const schemaIdeWorkspaceBindingName = "SCHEMA_IDE_WORKSPACES";

/** Worker binding name for the Cloudflare Artifacts (Git) namespace. */
export const schemaIdeArtifactsBindingName = "SCHEMA_IDE_ARTIFACTS";

export interface SchemaIdeArtifactsNamespaceOptions {
  /**
   * Cloudflare Artifacts namespace name (3–63 lowercase alphanumerics/hyphens).
   * Omit to let Alchemy generate a unique physical name from the resource id.
   */
  readonly namespace?: string | undefined;
}

/**
 * Declare the Cloudflare Artifacts (Git-for-agents) namespace binding. Wiring
 * it into a Worker's `bindings` gives `env.SCHEMA_IDE_ARTIFACTS` a runtime
 * client (`create`/`get`/`delete`/...) for managing per-workspace Git repos.
 *
 * Namespaces are implicit on Cloudflare — no deploy-time provisioning — so this
 * is safe to include unconditionally on accounts with the Artifacts beta.
 */
export function makeSchemaIdeArtifactsNamespace(options: SchemaIdeArtifactsNamespaceOptions = {}) {
  return Cloudflare.Artifacts(
    schemaIdeArtifactsBindingName,
    options.namespace ? { namespace: options.namespace } : {},
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
