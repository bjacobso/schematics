import { Effect, Result, Schema, SchemaIssue } from "effect";
import type { AnyArtifactApi, ArtifactCapability } from "./api";
import type { AnyArtifactView } from "./artifact-type";
import { artifactCacheKey, type ArtifactCacheConfig } from "./cache";
import type { ArtifactRegistryError } from "./errors";
import type { AnyArtifactHandler } from "./handler";
import type { ArtifactMetadata } from "./matcher";
import type { ArtifactCachePolicy } from "./policy";
import type { ArtifactRef } from "./ref";

export interface ArtifactViewOptions {
  readonly type?: string | undefined;
  readonly metadata?: ArtifactMetadata | undefined;
  /** Cache key for views annotated with `CachePolicy.explicitKey`. */
  readonly cacheKey?: string | undefined;
}

export class ArtifactRegistryDeclaration<
  Handlers extends readonly AnyArtifactHandler[] = readonly [],
> {
  readonly _tag = "ArtifactRegistry";

  constructor(
    readonly api: AnyArtifactApi,
    readonly handlers: Handlers = [] as unknown as Handlers,
    readonly cacheConfig?: ArtifactCacheConfig | undefined,
  ) {}

  addHandler<Handler extends AnyArtifactHandler>(
    handler: Handler,
  ): ArtifactRegistryDeclaration<readonly [...Handlers, Handler]> {
    return new ArtifactRegistryDeclaration(
      this.api,
      [...this.handlers, handler] as const,
      this.cacheConfig,
    );
  }

  /**
   * Returns a registry that honors view `cache` annotations through the given
   * cache. Views run their handler at most once per cache key; see
   * {@link ArtifactCachePolicy} for how keys are derived.
   */
  withCache(cacheConfig: ArtifactCacheConfig): ArtifactRegistryDeclaration<Handlers> {
    return new ArtifactRegistryDeclaration(this.api, this.handlers, cacheConfig);
  }

  capabilities(
    ref: ArtifactRef,
    metadata?: ArtifactMetadata,
  ): Effect.Effect<readonly ArtifactCapability[]> {
    return Effect.succeed(this.api.capabilities(ref, metadata));
  }

  view(
    ref: ArtifactRef,
    viewName: string,
    input?: unknown,
    options: ArtifactViewOptions = {},
  ): Effect.Effect<unknown, ArtifactRegistryError> {
    const registry = this;
    return Effect.gen(function* () {
      const matchedTypes = registry.api.match(ref, options.metadata);
      if (matchedTypes.length === 0) {
        return yield* Effect.fail({
          _tag: "ArtifactTypeNotFound",
          ref,
        } satisfies ArtifactRegistryError);
      }

      const candidateTypes = options.type
        ? matchedTypes.filter((artifactType) => artifactType.name === options.type)
        : matchedTypes;
      const candidateViews = candidateTypes
        .flatMap((artifactType) => artifactType.listViews())
        .filter((view) => view.name === viewName);

      if (candidateViews.length === 0) {
        return yield* Effect.fail({
          _tag: "ArtifactViewNotFound",
          ref,
          view: viewName,
          ...(options.type ? { type: options.type } : {}),
        } satisfies ArtifactRegistryError);
      }

      const view = candidateViews[0]!;
      const handler = registry.handlers.find((candidate) => candidate.view === view);
      if (!handler) {
        return yield* Effect.fail({
          _tag: "ArtifactHandlerNotFound",
          ref,
          view: view.name,
          type: view.type,
        } satisfies ArtifactRegistryError);
      }

      const decodedInput = yield* decodeInput(view, input);

      const cacheKey = yield* resolveCacheKey(
        registry.cacheConfig,
        view,
        ref,
        decodedInput,
        options,
      );
      if (cacheKey && registry.cacheConfig) {
        const lookup = yield* registry.cacheConfig.cache.lookup(cacheKey);
        // Cached values are stored post-decode, so a hit skips both the handler
        // and output validation.
        if (lookup.hit) return lookup.value;
      }

      const output = yield* handler
        .run({
          ref,
          input: decodedInput,
          ...(options.metadata ? { metadata: options.metadata } : {}),
        })
        .pipe(Effect.catch((error: unknown) => mapHandlerError({ error, view })));

      const decoded = yield* decodeSchema({
        schema: view.output,
        value: output,
        phase: "output",
        view: view.id,
      });

      // Only successful results reach here (failures short-circuit above), so a
      // transient handler error is never cached.
      if (cacheKey && registry.cacheConfig) {
        yield* registry.cacheConfig.cache.store(cacheKey, decoded);
      }

      return decoded;
    });
  }
}

function resolveCacheKey(
  cacheConfig: ArtifactCacheConfig | undefined,
  view: AnyArtifactView,
  ref: ArtifactRef,
  input: unknown,
  options: ArtifactViewOptions,
): Effect.Effect<string | null> {
  if (!cacheConfig) return Effect.succeed(null);
  const policy = (view.annotations.cache ?? "none") as ArtifactCachePolicy;
  if (policy === "none") return Effect.succeed(null);

  const buildKey = (contentHash: string | null) =>
    artifactCacheKey({
      policy,
      viewId: view.id,
      ref,
      input,
      contentHash,
      ...(cacheConfig.sessionId !== undefined ? { sessionId: cacheConfig.sessionId } : {}),
      ...(options.cacheKey !== undefined ? { explicitKey: options.cacheKey } : {}),
    });

  // Content hashing reads the artifact, so only resolve it for the policy that
  // needs it.
  if (policy === "contentHash" && cacheConfig.resolveContentHash) {
    return cacheConfig.resolveContentHash(ref).pipe(Effect.map(buildKey));
  }
  return Effect.succeed(buildKey(null));
}

export const ArtifactRegistry = {
  make: (api: AnyArtifactApi): ArtifactRegistryDeclaration => new ArtifactRegistryDeclaration(api),
} as const;

function decodeInput(
  view: AnyArtifactView,
  input: unknown,
): Effect.Effect<unknown, ArtifactRegistryError> {
  if (!view.input) {
    return input === undefined
      ? Effect.succeed(undefined)
      : Effect.fail({ _tag: "ArtifactUnexpectedInput", view: view.id });
  }

  return decodeSchema({
    schema: view.input,
    value: input,
    phase: "input",
    view: view.id,
  });
}

function mapHandlerError({
  error,
  view,
}: {
  readonly error: unknown;
  readonly view: AnyArtifactView;
}): Effect.Effect<never, ArtifactRegistryError> {
  const errorSchema = view.error;
  if (!errorSchema) {
    return Effect.fail({ _tag: "ArtifactHandlerFailed", view: view.id, error });
  }

  return Effect.gen(function* () {
    const decodedError = yield* decodeSchema({
      schema: errorSchema,
      value: error,
      phase: "error",
      view: view.id,
    });

    return yield* Effect.fail({
      _tag: "ArtifactHandlerFailed",
      view: view.id,
      error: decodedError,
    } satisfies ArtifactRegistryError);
  });
}

function decodeSchema<A>({
  schema,
  value,
  phase,
  view,
}: {
  readonly schema: Schema.Schema<A>;
  readonly value: unknown;
  readonly phase: "input" | "output" | "error";
  readonly view: string;
}): Effect.Effect<A, ArtifactRegistryError> {
  const result = Schema.decodeUnknownResult(schema as never)(value) as unknown as Result.Result<
    A,
    SchemaIssue.Issue
  >;

  if (Result.isSuccess(result)) return Effect.succeed(result.success);

  return Effect.fail({
    _tag: "ArtifactSchemaValidationError",
    phase,
    view,
    issue: result.failure,
    message: SchemaIssue.makeFormatterDefault()(result.failure),
  });
}
