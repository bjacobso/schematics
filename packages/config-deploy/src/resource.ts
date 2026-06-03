import { Effect, type Schema } from "effect";
import type { ProviderError } from "./errors";
import type {
  ApplyContext,
  ConfigProvider,
  RemoteEntity,
  RemoteSummary,
  ResourceRef,
} from "./provider";

/**
 * Input to a resource's `reconcile`, in Alchemy's `news`/`olds` style.
 *
 * - `news` — the desired props (from the file).
 * - `olds` — the live value at plan time, or `null` on create.
 * - `remoteId` — the opaque id being updated, or `null` on create.
 * - `resolveRemoteId(kind, key)` — resolve a cross-entity slug to its remote id
 *   (reflects in-progress applies + the lockfile).
 */
export interface ResourceReconcile<Props> {
  readonly news: Props;
  readonly olds: Props | null;
  readonly remoteId: string | null;
  readonly resolveRemoteId: (kind: string, key: string) => string | null;
}

/**
 * Ergonomic resource definition — a single `reconcile` (create + update) plus
 * `list`/`read`/`remove`, with identity derived from a `keyField`. Compiles to a
 * standard {@link ConfigProvider}, so the engine is unchanged.
 */
export interface ResourceDefinition<Props> {
  readonly kind: string;
  readonly schema: Schema.Schema<Props>;
  readonly route: string;
  readonly path: (key: string) => string;
  /** Field on `Props` that holds the slug (derives key/withKey). */
  readonly keyField?: (keyof Props & string) | undefined;
  /** Read the slug from props (defaults to `props[keyField]`). */
  readonly key?: ((props: Props) => string) | undefined;
  /** Pin a slug into props before writing (defaults to `{...props, [keyField]: key}`). */
  readonly withKey?: ((props: Props, key: string) => Props) | undefined;
  /** Suggest a slug for a freshly-discovered remote entity (defaults to `key(entity.props)`). */
  readonly slug?: ((entity: RemoteEntity<Props>) => string) | undefined;
  readonly dependsOn?: ((props: Props) => readonly ResourceRef[]) | undefined;

  readonly list: Effect.Effect<readonly RemoteEntity<Props>[], ProviderError>;
  readonly read: (remoteId: string) => Effect.Effect<RemoteEntity<Props> | null, ProviderError>;
  /** Create (`remoteId === null`) or update — one handler, `news`/`olds` style. */
  readonly reconcile: (
    input: ResourceReconcile<Props>,
  ) => Effect.Effect<RemoteEntity<Props>, ProviderError>;
  readonly remove: (remoteId: string) => Effect.Effect<void, ProviderError>;
  /** Cheap list for skeleton/seed; defaults to deriving `{remoteId, suggestedKey}` from `list`. */
  readonly listSummaries?: Effect.Effect<readonly RemoteSummary[], ProviderError> | undefined;
}

export function defineResource<Props>(def: ResourceDefinition<Props>): ConfigProvider<Props> {
  const keyField = def.keyField;
  if (!def.key && !keyField) {
    throw new Error(`defineResource(${def.kind}): provide \`key\` or \`keyField\``);
  }
  const keyOf =
    def.key ?? ((props: Props) => String((props as Record<string, unknown>)[keyField as string]));
  const applyKey =
    def.withKey ??
    (keyField
      ? (props: Props, key: string): Props => ({ ...props, [keyField]: key })
      : (props: Props): Props => props);
  const suggestKey = def.slug ?? ((entity: RemoteEntity<Props>) => keyOf(entity.props));
  const listSummaries =
    def.listSummaries ??
    def.list.pipe(
      Effect.map((entities) =>
        entities.map((entity) => ({ remoteId: entity.remoteId, suggestedKey: suggestKey(entity) })),
      ),
    );

  return {
    kind: def.kind,
    schema: def.schema,
    keyOf,
    suggestKey,
    applyKey,
    pathFor: def.path,
    route: def.route,
    dependsOn: def.dependsOn,
    listSummaries,
    list: def.list,
    read: def.read,
    create: (props: Props, context: ApplyContext) =>
      def.reconcile({
        news: props,
        olds: null,
        remoteId: null,
        resolveRemoteId: context.resolveRemoteId,
      }),
    update: (remoteId: string, props: Props, context: ApplyContext, before?: Props | null) =>
      def.reconcile({
        news: props,
        olds: before ?? null,
        remoteId,
        resolveRemoteId: context.resolveRemoteId,
      }),
    delete: def.remove,
  };
}
