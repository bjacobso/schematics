import {
  SchematicsArtifactProjectError,
  SchematicsArtifactProjectRpcGroup,
  artifactProjectRpcErrorToError,
  type SchematicsArtifactProjectService,
} from "@schematics/protocol";
import { Effect, Stream } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

const toClientError = (error: unknown): SchematicsArtifactProjectError => {
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    return artifactProjectRpcErrorToError(
      error as Parameters<typeof artifactProjectRpcErrorToError>[0],
    );
  }
  return new SchematicsArtifactProjectError(
    error instanceof Error ? error.message : String(error),
    "storage",
  );
};

export const createRpcArtifactProjectClient = (
  baseUrl = "",
  rpcPath = "/v1/artifact-project/rpc",
): SchematicsArtifactProjectService => {
  const url = `${baseUrl.replace(/\/$/, "")}${rpcPath.startsWith("/") ? rpcPath : `/${rpcPath}`}`;
  const makeClient = RpcClient.make(SchematicsArtifactProjectRpcGroup).pipe(
    Effect.provide(RpcClient.layerProtocolHttp({ url })),
    Effect.provide(RpcSerialization.layerNdjson),
    Effect.provide(FetchHttpClient.layer),
  );
  return {
    getCapabilities: Effect.scoped(
      Effect.flatMap(makeClient, (client) => client.GetCapabilities(undefined)),
    ).pipe(Effect.mapError(toClientError)),
    getSnapshot: Effect.scoped(
      Effect.flatMap(makeClient, (client) => client.GetSnapshot(undefined)),
    ).pipe(Effect.mapError(toClientError)),
    watchArtifactProject: Stream.unwrap(
      makeClient.pipe(Effect.map((client) => client.WatchArtifactProject(undefined))),
    ).pipe(Stream.scoped, Stream.mapError(toClientError)),
    applyChange: (change) =>
      Effect.scoped(
        Effect.flatMap(makeClient, (client) => client.ApplyArtifactProjectChange(change)),
      ).pipe(Effect.mapError(toClientError)),
    getHistory: Effect.scoped(
      Effect.flatMap(makeClient, (client) => client.GetHistory(undefined)),
    ).pipe(Effect.mapError(toClientError)),
    previewFiles: (request) =>
      Effect.scoped(
        Effect.flatMap(makeClient, (client) => client.PreviewArtifactProjectFiles(request)),
      ).pipe(Effect.mapError(toClientError)),
    listArtifactRefs: Effect.scoped(
      Effect.flatMap(makeClient, (client) => client.ListArtifactRefs(undefined)),
    ).pipe(Effect.mapError(toClientError)),
    getArtifactCapabilities: (request) =>
      Effect.scoped(
        Effect.flatMap(makeClient, (client) => client.GetArtifactCapabilities(request)),
      ).pipe(Effect.mapError(toClientError)),
    readArtifactView: (request) =>
      Effect.scoped(Effect.flatMap(makeClient, (client) => client.ReadArtifactView(request))).pipe(
        Effect.mapError(toClientError),
      ),
    readArtifactViews: (request) =>
      Effect.scoped(Effect.flatMap(makeClient, (client) => client.ReadArtifactViews(request))).pipe(
        Effect.mapError(toClientError),
      ),
    applyArtifactChange: (change) =>
      Effect.scoped(
        Effect.flatMap(makeClient, (client) => client.ApplyArtifactChange(change)),
      ).pipe(Effect.mapError(toClientError)),
  };
};
