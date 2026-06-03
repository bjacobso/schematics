import * as Cloudflare from "alchemy/Cloudflare";
import { Stack } from "alchemy/Stack";
import { Effect } from "effect";

export const schematicsWorkspaceObjectClassName = "SchematicsWorkspaceObject";
export const schematicsWorkspaceBindingName = "SCHEMATICS_WORKSPACES";

/** Worker binding name for the Cloudflare Artifacts (Git) namespace. */
export const schematicsArtifactsBindingName = "SCHEMATICS_ARTIFACTS";

/** Prefix for the per-stage Artifacts namespace name. */
const artifactsNamespacePrefix = "schematics-workspaces";

export interface SchematicsArtifactsNamespaceOptions {
  /**
   * Explicit Cloudflare Artifacts namespace name (3–63 lowercase alphanumerics
   * and hyphens). Omit to derive a per-stage name like `schematics-workspaces-pr-20`.
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
 * it into a Worker's `bindings` gives `env.SCHEMATICS_ARTIFACTS` a runtime
 * client (`create`/`get`/`delete`/...) for managing per-workspace Git repos.
 *
 * The namespace is **per-stage** by default (e.g. `schematics-workspaces-pr-20`,
 * `schematics-workspaces-prod`) so each deploy stage gets its own isolated set
 * of workspace repos — mirroring how the Api/Playground workers are named per
 * stage. Alchemy's own default (lowercasing the binding name) is both invalid
 * (underscores) and not stage-scoped, so the name is built explicitly here.
 */
export function makeSchematicsArtifactsNamespace(
  options: SchematicsArtifactsNamespaceOptions = {},
) {
  if (options.namespace) {
    return Cloudflare.Artifacts(schematicsArtifactsBindingName, {
      namespace: toArtifactsNamespace(options.namespace),
    });
  }
  return Effect.flatMap(Stack, (stack) =>
    Cloudflare.Artifacts(schematicsArtifactsBindingName, {
      namespace: toArtifactsNamespace(`${artifactsNamespacePrefix}-${stack.stage}`),
    }),
  );
}

export interface SchematicsWorkspaceNamespaceOptions {
  readonly name?: string | undefined;
  readonly className?: string | undefined;
}

export interface SchematicsApiWorkerOptions<
  Bindings extends Cloudflare.WorkerBindingProps = {},
> extends Omit<Cloudflare.WorkerProps<Bindings>, "main" | "env" | "bindings"> {
  readonly main: string;
  readonly env?: NonNullable<Cloudflare.WorkerProps["env"]>;
  readonly bindings?: Bindings;
  readonly workspaceBindingName?: string | undefined;
  readonly workspaceNamespace?: Cloudflare.WorkerBindingProps[string];
}

export function makeSchematicsWorkspaceNamespace(
  options: SchematicsWorkspaceNamespaceOptions = {},
) {
  return Cloudflare.DurableObjectNamespace(options.name ?? schematicsWorkspaceObjectClassName, {
    className: options.className ?? schematicsWorkspaceObjectClassName,
  });
}

export function makeSchematicsApiWorker(name: string, options: SchematicsApiWorkerOptions) {
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
    [workspaceBindingName ?? schematicsWorkspaceBindingName]:
      workspaceNamespace ?? makeSchematicsWorkspaceNamespace(),
  } satisfies Cloudflare.WorkerBindingProps;
  const props = {
    ...workerOptions,
    main,
    bindings,
    ...(env ? { env } : {}),
  };
  return Cloudflare.Worker(name, props);
}
