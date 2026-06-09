import {
  SchematicsDeployError,
  SchematicsDeployRpcGroup,
  deployRpcErrorToError,
  type SchematicsDeployService,
} from "@schematics/protocol";
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
): SchematicsDeployService {
  const url = `${baseUrl.replace(/\/$/, "")}${rpcPath.startsWith("/") ? rpcPath : `/${rpcPath}`}`;
  const makeClient = RpcClient.make(SchematicsDeployRpcGroup).pipe(
    Effect.provide(RpcClient.layerProtocolHttp({ url })),
    Effect.provide(RpcSerialization.layerNdjson),
    Effect.provide(FetchHttpClient.layer),
  );

  return {
    connect: (request) =>
      Effect.scoped(Effect.flatMap(makeClient, (client) => client.DeployConnect(request))).pipe(
        Effect.mapError(toDeployError),
      ),
    getConnection: (request) =>
      Effect.scoped(
        Effect.flatMap(makeClient, (client) => client.DeployGetConnection(request)),
      ).pipe(Effect.mapError(toDeployError)),
    listConnections: Effect.scoped(
      Effect.flatMap(makeClient, (client) => client.DeployListConnections(undefined)),
    ).pipe(Effect.mapError(toDeployError)),
    deleteConnection: (request) =>
      Effect.scoped(
        Effect.flatMap(makeClient, (client) => client.DeployDeleteConnection(request)),
      ).pipe(Effect.mapError(toDeployError)),
    getConnectionOptions: Effect.scoped(
      Effect.flatMap(makeClient, (client) => client.DeployGetConnectionOptions(undefined)),
    ).pipe(Effect.mapError(toDeployError)),
    pull: (request) =>
      Effect.scoped(Effect.flatMap(makeClient, (client) => client.DeployPull(request))).pipe(
        Effect.mapError(toDeployError),
      ),
    plan: (request) =>
      Effect.scoped(Effect.flatMap(makeClient, (client) => client.DeployPlan(request))).pipe(
        Effect.mapError(toDeployError),
      ),
    apply: (request) =>
      Effect.scoped(Effect.flatMap(makeClient, (client) => client.DeployApply(request))).pipe(
        Effect.mapError(toDeployError),
      ),
    destroy: (request) =>
      Effect.scoped(Effect.flatMap(makeClient, (client) => client.DeployDestroy(request))).pipe(
        Effect.mapError(toDeployError),
      ),
    listRuns: Effect.scoped(
      Effect.flatMap(makeClient, (client) => client.ListDeployRuns(undefined)),
    ).pipe(Effect.mapError(toDeployError)),
    watch: Stream.unwrap(
      makeClient.pipe(Effect.map((client) => client.WatchDeploy(undefined))),
    ).pipe(Stream.scoped, Stream.mapError(toDeployError)),
  };
}

function toDeployError(error: unknown): SchematicsDeployError {
  if (error instanceof SchematicsDeployError) return error;
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    return deployRpcErrorToError(error as Parameters<typeof deployRpcErrorToError>[0]);
  }
  return new SchematicsDeployError(
    error instanceof Error ? error.message : String(error),
    "storage",
  );
}
