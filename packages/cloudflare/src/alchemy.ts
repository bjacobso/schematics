import * as Cloudflare from "alchemy/Cloudflare";

export const schemaIdeWorkspaceObjectClassName = "SchemaIdeWorkspaceObject";
export const schemaIdeWorkspaceBindingName = "SCHEMA_IDE_WORKSPACES";

export interface SchemaIdeWorkspaceNamespaceOptions {
  readonly name?: string | undefined;
  readonly className?: string | undefined;
}

export interface SchemaIdeApiWorkerOptions<Bindings extends Cloudflare.WorkerBindingProps = {}>
  extends Omit<Cloudflare.WorkerProps<Bindings>, "main" | "env" | "bindings"> {
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
