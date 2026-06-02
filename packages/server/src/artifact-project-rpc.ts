import { Effect, Stream } from "effect";
import {
  SchemaIdeArtifactProjectRpcGroup,
  toArtifactProjectRpcError,
  type SchemaIdeArtifactProjectService,
} from "@schema-ide/protocol";

export const makeSchemaIdeArtifactProjectRpcHandlers = (
  workspace: SchemaIdeArtifactProjectService,
) =>
  SchemaIdeArtifactProjectRpcGroup.of({
    GetCapabilities: () =>
      workspace.getCapabilities.pipe(Effect.mapError(toArtifactProjectRpcError)),
    GetSnapshot: () => workspace.getSnapshot.pipe(Effect.mapError(toArtifactProjectRpcError)),
    WatchArtifactProjectState: () =>
      workspace.watchArtifactProjectState.pipe(Stream.mapError(toArtifactProjectRpcError)),
    WatchArtifactProject: () =>
      workspace.watchArtifactProject.pipe(Stream.mapError(toArtifactProjectRpcError)),
    ApplyArtifactProjectChange: (change) =>
      workspace.applyChange(change).pipe(Effect.mapError(toArtifactProjectRpcError)),
    PreviewArtifactProjectFiles: (request) =>
      workspace.previewFiles(request).pipe(Effect.mapError(toArtifactProjectRpcError)),
    ListArtifactRefs: () =>
      workspace.listArtifactRefs.pipe(Effect.mapError(toArtifactProjectRpcError)),
    GetArtifactCapabilities: (request) =>
      workspace.getArtifactCapabilities(request).pipe(Effect.mapError(toArtifactProjectRpcError)),
    ReadArtifactView: (request) =>
      workspace.readArtifactView(request).pipe(Effect.mapError(toArtifactProjectRpcError)),
    ApplyArtifactChange: (change) =>
      workspace.applyArtifactChange(change).pipe(Effect.mapError(toArtifactProjectRpcError)),
  });

export const makeSchemaIdeArtifactProjectRpcLayer = (workspace: SchemaIdeArtifactProjectService) =>
  SchemaIdeArtifactProjectRpcGroup.toLayer(makeSchemaIdeArtifactProjectRpcHandlers(workspace));
