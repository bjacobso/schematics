import {
  SchemaIdeDeployError,
  SchemaIdeDeployRpcGroup,
  deployRpcErrorToError,
  type SchemaIdeDeployService,
} from "@schema-ide/protocol";
import { Effect, Stream } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

/**
 * HTTP RPC client for the server-side deploy engine (`/v1/deploy/rpc`),
 * mirroring {@link createRpcArtifactProjectClient}. The engine runs on the
 * server holding credentials + the working-tree store; this drives it.
 */
export function createRpcDeployClient(
  baseUrl = "",
  rpcPath = "/v1/deploy/rpc",
): SchemaIdeDeployService {
  const url = `${baseUrl.replace(/\/$/, "")}${rpcPath.startsWith("/") ? rpcPath : `/${rpcPath}`}`;
  const makeClient = RpcClient.make(SchemaIdeDeployRpcGroup).pipe(
    Effect.provide(RpcClient.layerProtocolHttp({ url })),
    Effect.provide(RpcSerialization.layerNdjson),
    Effect.provide(FetchHttpClient.layer),
  );

  return {
    connect: (request) =>
      Effect.scoped(Effect.flatMap(makeClient, (client) => client.DeployConnect(request))).pipe(
        Effect.mapError(toDeployError),
      ),
    getConnection: Effect.scoped(
      Effect.flatMap(makeClient, (client) => client.DeployGetConnection(undefined)),
    ).pipe(Effect.mapError(toDeployError)),
    pull: Effect.scoped(Effect.flatMap(makeClient, (client) => client.DeployPull(undefined))).pipe(
      Effect.mapError(toDeployError),
    ),
    plan: Effect.scoped(Effect.flatMap(makeClient, (client) => client.DeployPlan(undefined))).pipe(
      Effect.mapError(toDeployError),
    ),
    apply: (request) =>
      Effect.scoped(Effect.flatMap(makeClient, (client) => client.DeployApply(request))).pipe(
        Effect.mapError(toDeployError),
      ),
    destroy: Effect.scoped(
      Effect.flatMap(makeClient, (client) => client.DeployDestroy(undefined)),
    ).pipe(Effect.mapError(toDeployError)),
    listRuns: Effect.scoped(
      Effect.flatMap(makeClient, (client) => client.ListDeployRuns(undefined)),
    ).pipe(Effect.mapError(toDeployError)),
    watch: Stream.unwrap(
      makeClient.pipe(Effect.map((client) => client.WatchDeploy(undefined))),
    ).pipe(Stream.scoped, Stream.mapError(toDeployError)),
  };
}

function toDeployError(error: unknown): SchemaIdeDeployError {
  if (error instanceof SchemaIdeDeployError) return error;
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    return deployRpcErrorToError(error as Parameters<typeof deployRpcErrorToError>[0]);
  }
  return new SchemaIdeDeployError(
    error instanceof Error ? error.message : String(error),
    "storage",
  );
}
