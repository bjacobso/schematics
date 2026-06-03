import { Effect, Stream } from "effect";
import {
  SchematicsDeployRpcGroup,
  toDeployRpcError,
  type SchematicsDeployService,
} from "@schematics/protocol";

export const makeSchematicsDeployRpcHandlers = (deploy: SchematicsDeployService) =>
  SchematicsDeployRpcGroup.of({
    DeployConnect: (request) => deploy.connect(request).pipe(Effect.mapError(toDeployRpcError)),
    DeployGetConnection: () => deploy.getConnection.pipe(Effect.mapError(toDeployRpcError)),
    DeployGetConnectionOptions: () =>
      deploy.getConnectionOptions.pipe(Effect.mapError(toDeployRpcError)),
    DeployPull: () => deploy.pull.pipe(Effect.mapError(toDeployRpcError)),
    DeployPlan: () => deploy.plan.pipe(Effect.mapError(toDeployRpcError)),
    DeployApply: (request) => deploy.apply(request).pipe(Effect.mapError(toDeployRpcError)),
    DeployDestroy: () => deploy.destroy.pipe(Effect.mapError(toDeployRpcError)),
    ListDeployRuns: () => deploy.listRuns.pipe(Effect.mapError(toDeployRpcError)),
    WatchDeploy: () => deploy.watch.pipe(Stream.mapError(toDeployRpcError)),
  });

export const makeSchematicsDeployRpcLayer = (deploy: SchematicsDeployService) =>
  SchematicsDeployRpcGroup.toLayer(makeSchematicsDeployRpcHandlers(deploy));
