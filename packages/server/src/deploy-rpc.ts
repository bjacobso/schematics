import { Effect, Stream } from "effect";
import {
  SchematicsDeployRpcGroup,
  toDeployRpcError,
  type SchematicsDeployService,
} from "@schematics/protocol";

export const makeSchematicsDeployRpcHandlers = (deploy: SchematicsDeployService) =>
  SchematicsDeployRpcGroup.of({
    DeployConnect: (request) => deploy.connect(request).pipe(Effect.mapError(toDeployRpcError)),
    DeployGetConnection: (request) =>
      deploy.getConnection(request).pipe(Effect.mapError(toDeployRpcError)),
    DeployListConnections: () => deploy.listConnections.pipe(Effect.mapError(toDeployRpcError)),
    DeployDeleteConnection: (request) =>
      deploy.deleteConnection(request).pipe(Effect.mapError(toDeployRpcError)),
    DeployGetConnectionOptions: () =>
      deploy.getConnectionOptions.pipe(Effect.mapError(toDeployRpcError)),
    DeployPull: (request) => deploy.pull(request).pipe(Effect.mapError(toDeployRpcError)),
    DeployPlan: (request) => deploy.plan(request).pipe(Effect.mapError(toDeployRpcError)),
    DeployApply: (request) => deploy.apply(request).pipe(Effect.mapError(toDeployRpcError)),
    DeployDestroy: (request) => deploy.destroy(request).pipe(Effect.mapError(toDeployRpcError)),
    ListDeployRuns: () => deploy.listRuns.pipe(Effect.mapError(toDeployRpcError)),
    WatchDeploy: () => deploy.watch.pipe(Stream.mapError(toDeployRpcError)),
  });

export const makeSchematicsDeployRpcLayer = (deploy: SchematicsDeployService) =>
  SchematicsDeployRpcGroup.toLayer(makeSchematicsDeployRpcHandlers(deploy));
