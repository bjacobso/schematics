import {
  SchematicsArtifactWorkflowRpcGroup,
  type ArtifactWorkflowRpcError,
  type SchematicsArtifactWorkflowService,
} from "@schematics/protocol";
import { Effect, Stream } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

export function createRpcArtifactWorkflowClient(
  baseUrl = "",
  rpcPath = "/v1/artifact-workflow/rpc",
): SchematicsArtifactWorkflowService {
  const url = `${baseUrl.replace(/\/$/, "")}${rpcPath.startsWith("/") ? rpcPath : `/${rpcPath}`}`;
  const makeClient = RpcClient.make(SchematicsArtifactWorkflowRpcGroup).pipe(
    Effect.provide(RpcClient.layerProtocolHttp({ url })),
    Effect.provide(RpcSerialization.layerNdjson),
    Effect.provide(FetchHttpClient.layer),
  );

  return {
    listIngestors: Effect.scoped(
      Effect.flatMap(makeClient, (client) => client.ListArtifactWorkflowIngestors(undefined)),
    ).pipe(Effect.mapError(toArtifactWorkflowRpcError)),
    startRun: (request) =>
      Effect.scoped(
        Effect.flatMap(makeClient, (client) => client.StartArtifactWorkflowRun(request)),
      ).pipe(Effect.mapError(toArtifactWorkflowRpcError)),
    watchRun: (request) =>
      Stream.unwrap(
        makeClient.pipe(Effect.map((client) => client.WatchArtifactWorkflowRun(request))),
      ).pipe(Stream.scoped, Stream.mapError(toArtifactWorkflowRpcError)),
    resumeRun: (request) =>
      Effect.scoped(
        Effect.flatMap(makeClient, (client) => client.ResumeArtifactWorkflowRun(request)),
      ).pipe(Effect.mapError(toArtifactWorkflowRpcError)),
    getRunReport: (request) =>
      Effect.scoped(
        Effect.flatMap(makeClient, (client) => client.GetArtifactWorkflowRunReport(request)),
      ).pipe(Effect.mapError(toArtifactWorkflowRpcError)),
  };
}

function toArtifactWorkflowRpcError(error: unknown): ArtifactWorkflowRpcError {
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    return error as ArtifactWorkflowRpcError;
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    code: "storage",
  };
}
