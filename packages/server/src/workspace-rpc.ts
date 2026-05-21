import { Effect, Stream } from "effect";
import {
  SchemaIdeWorkspaceRpcGroup,
  toWorkspaceRpcError,
  type SchemaIdeWorkspaceService,
} from "@schema-ide/protocol";

export const makeSchemaIdeWorkspaceRpcHandlers = (workspace: SchemaIdeWorkspaceService) =>
  SchemaIdeWorkspaceRpcGroup.of({
    GetCapabilities: () => workspace.getCapabilities.pipe(Effect.mapError(toWorkspaceRpcError)),
    GetSnapshot: () => workspace.getSnapshot.pipe(Effect.mapError(toWorkspaceRpcError)),
    WatchWorkspace: () => workspace.watchWorkspace.pipe(Stream.mapError(toWorkspaceRpcError)),
    ApplyWorkspaceChange: (change) =>
      workspace.applyChange(change).pipe(Effect.mapError(toWorkspaceRpcError)),
    PreviewWorkspaceFiles: (request) =>
      workspace.previewFiles(request).pipe(Effect.mapError(toWorkspaceRpcError)),
  });

export const makeSchemaIdeWorkspaceRpcLayer = (workspace: SchemaIdeWorkspaceService) =>
  SchemaIdeWorkspaceRpcGroup.toLayer(makeSchemaIdeWorkspaceRpcHandlers(workspace));
