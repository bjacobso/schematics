import { Effect, Result, Schema, SchemaIssue } from "effect";
import type { AnyArtifactApi, ArtifactCapability } from "./api";
import type { AnyArtifactView } from "./artifact-type";
import type { ArtifactRegistryError } from "./errors";
import type { AnyArtifactHandler } from "./handler";
import type { ArtifactMetadata } from "./matcher";
import type { ArtifactRef } from "./ref";

export interface ArtifactViewOptions {
  readonly type?: string | undefined;
  readonly metadata?: ArtifactMetadata | undefined;
}

export class ArtifactRegistryDeclaration<
  Handlers extends readonly AnyArtifactHandler[] = readonly [],
> {
  readonly _tag = "ArtifactRegistry";

  constructor(
    readonly api: AnyArtifactApi,
    readonly handlers: Handlers = [] as unknown as Handlers,
  ) {}

  addHandler<Handler extends AnyArtifactHandler>(
    handler: Handler,
  ): ArtifactRegistryDeclaration<readonly [...Handlers, Handler]> {
    return new ArtifactRegistryDeclaration(this.api, [...this.handlers, handler] as const);
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
      const output = yield* handler
        .run({
          ref,
          input: decodedInput,
          ...(options.metadata ? { metadata: options.metadata } : {}),
        })
        .pipe(Effect.catch((error: unknown) => mapHandlerError({ error, view })));

      return yield* decodeSchema({
        schema: view.output,
        value: output,
        phase: "output",
        view: view.id,
      });
    });
  }
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
