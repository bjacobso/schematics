import type { ArtifactStore } from "@schematics/artifacts";
import {
  artifactConfigStateStore,
  defineResource as defineResourceHandler,
  makeConfigDeploy,
  makeRateLimiter,
  throttleProvider,
  ProviderError,
  type ConfigDeploy,
  type ProviderOperation,
  type RemoteEntity,
  type ResourceHandler,
} from "@schematics/alchemy";
import { yamlConfigCodec } from "@schematics/deploy";
import { type Duration, Effect } from "effect";
import type { NormalizedResource, ResourceCrud } from "./resource";

const identity = <A, B>(value: A): B => value as unknown as B;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/**
 * Derive one alchemy {@link ResourceHandler} from a resource declaration: map
 * the transport's CRUD through the resource's `decode`/`encode`, key files by
 * `key`, and honor `writeOps`. A `read-only` resource fails on create/update,
 * no-ops on remove, and derives `read` from `list` — exactly the shape of a
 * hand-written read-only container provider.
 */
export function deriveResourceHandler(
  resource: NormalizedResource,
  api: unknown,
): ResourceHandler<any> {
  // Default selector: pick the segment keyed by `remoteKey` off the transport.
  const crud = (
    resource.remote ? resource.remote(api) : (api as Record<string, unknown>)[resource.remoteKey]
  ) as ResourceCrud<any> | undefined;
  const decode = resource.decode ?? identity;
  const encodeCreate = resource.encode?.create ?? identity;
  const encodeUpdate = resource.encode?.update ?? resource.encode?.create ?? identity;
  const key = resource.key;
  const readOnly = resource.writeOps === "read-only";

  const remoteIdOf = (config: any): string => String(config[key]);
  const entity = (config: any): RemoteEntity<any> => ({
    remoteId: remoteIdOf(config),
    props: config,
  });
  const mapError =
    (operation: ProviderOperation, entityKey?: string) =>
    (error: unknown): ProviderError =>
      new ProviderError({
        kind: resource.kind,
        operation,
        key: entityKey,
        message: messageOf(error),
      });
  const path = resource.single
    ? (): string => resource.route
    : (slug: string): string => resource.route.replace("*", slug);

  const requireCrud = (): ResourceCrud<any> => {
    if (!crud) throw new Error(`Resource "${resource.kind}" has no remote transport`);
    return crud;
  };

  const list = requireCrud().list.pipe(
    Effect.map((dtos: readonly any[]) => dtos.map((dto) => entity(decode(dto)))),
    Effect.mapError(mapError("list")),
  );

  return defineResourceHandler<any>({
    kind: resource.kind,
    schema: resource.schema as any,
    route: resource.route,
    path,
    keyField: key,
    ...(resource.slug ? { slug: (e: RemoteEntity<any>) => resource.slug!(e.props) } : {}),
    list,
    read: (id: string) =>
      readOnly
        ? list.pipe(Effect.map((entities) => entities.find((e) => e.remoteId === id) ?? null))
        : requireCrud()
            .get(id)
            .pipe(
              Effect.map((dto: any) => (dto ? entity(decode(dto)) : null)),
              Effect.mapError(mapError("read", id)),
            ),
    reconcile: ({ news, remoteId }: { news: any; remoteId: string | null }) => {
      if (readOnly) {
        return Effect.fail(
          new ProviderError({
            kind: resource.kind,
            operation: remoteId === null ? "create" : "update",
            message: `${resource.kind} is read-only via config-as-code`,
          }),
        );
      }
      if (remoteId !== null && resource.writeOps !== "full") {
        return Effect.fail(
          new ProviderError({
            kind: resource.kind,
            operation: "update",
            key: remoteIdOf(news),
            message: `${resource.kind} does not support updates`,
          }),
        );
      }
      const dto = remoteId === null ? encodeCreate(news) : encodeUpdate(news);
      return (
        remoteId === null ? requireCrud().create(dto) : requireCrud().update(remoteId, dto)
      ).pipe(
        Effect.map((result: any) => entity(decode(result))),
        Effect.mapError(mapError(remoteId === null ? "create" : "update", remoteIdOf(news))),
      );
    },
    remove: (id: string) =>
      readOnly
        ? Effect.void
        : requireCrud()
            .delete(id)
            .pipe(Effect.mapError(mapError("delete", id))),
  });
}

export interface MakeProviderConfigDeployOptions {
  readonly store: ArtifactStore;
  /** The provider's transport (live or mock) that resources select their CRUD from. */
  readonly api: unknown;
  readonly projectId?: string | undefined;
  readonly lockfilePath?: string | undefined;
  readonly throttle?: { readonly interval?: Duration.Input } | undefined;
}

/**
 * Wire a resource set into the alchemy engine: one derived {@link ResourceHandler}
 * per resource (in declaration order), the YAML codec, and a committed lockfile.
 */
export function makeProviderConfigDeploy(
  resources: readonly NormalizedResource[],
  options: MakeProviderConfigDeployOptions,
): ConfigDeploy {
  const state = artifactConfigStateStore(options.store, {
    path: options.lockfilePath ?? "config.lock.json",
    projectId: options.projectId,
  });
  const limiter = options.throttle
    ? makeRateLimiter({ interval: options.throttle.interval ?? "1 second" })
    : null;
  const providers = resources.map((resource) => {
    const handler = deriveResourceHandler(resource, options.api);
    return limiter ? throttleProvider(handler, limiter) : handler;
  });
  return makeConfigDeploy({
    store: options.store,
    providers,
    codec: yamlConfigCodec,
    state,
    ...(options.projectId ? { projectId: options.projectId } : {}),
  });
}
