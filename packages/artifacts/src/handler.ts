import type { Effect } from "effect";
import type {
  AnyArtifactView,
  ArtifactViewError,
  ArtifactViewInput,
  ArtifactViewOutput,
} from "./artifact-type";
import type { ArtifactMetadata } from "./matcher";
import type { ArtifactRef } from "./ref";

export interface ArtifactHandlerRequest<Input> {
  readonly ref: ArtifactRef;
  readonly input: Input;
  readonly metadata?: ArtifactMetadata | undefined;
}

export interface ArtifactHandler<View extends AnyArtifactView = AnyArtifactView, R = never> {
  readonly _tag: "ArtifactHandler";
  readonly view: View;
  readonly run: (
    request: ArtifactHandlerRequest<ArtifactViewInput<View>>,
  ) => Effect.Effect<ArtifactViewOutput<View>, ArtifactViewError<View>, R>;
}

export type AnyArtifactHandler = ArtifactHandler<AnyArtifactView, never>;

export const ArtifactHandler = {
  make: <View extends AnyArtifactView, R = never>(
    view: View,
    run: (
      request: ArtifactHandlerRequest<ArtifactViewInput<View>>,
    ) => Effect.Effect<ArtifactViewOutput<View>, ArtifactViewError<View>, R>,
  ): ArtifactHandler<View, R> => ({
    _tag: "ArtifactHandler",
    view,
    run,
  }),
} as const;
