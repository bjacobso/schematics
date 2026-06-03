import { Effect, Stream } from "effect";
import {
  SchematicsArtifactProjectRpcGroup,
  toArtifactProjectRpcError,
  type SchematicsArtifactProjectService,
} from "@schematics/protocol";

export const makeSchematicsArtifactProjectRpcHandlers = (
  artifactProject: SchematicsArtifactProjectService,
) =>
  SchematicsArtifactProjectRpcGroup.of({
    GetCapabilities: () =>
      artifactProject.getCapabilities.pipe(Effect.mapError(toArtifactProjectRpcError)),
    GetSnapshot: () => artifactProject.getSnapshot.pipe(Effect.mapError(toArtifactProjectRpcError)),
    WatchArtifactProject: () =>
      artifactProject.watchArtifactProject.pipe(Stream.mapError(toArtifactProjectRpcError)),
    ApplyArtifactProjectChange: (change) =>
      artifactProject.applyChange(change).pipe(Effect.mapError(toArtifactProjectRpcError)),
    PreviewArtifactProjectFiles: (request) =>
      artifactProject.previewFiles(request).pipe(Effect.mapError(toArtifactProjectRpcError)),
    ListArtifactRefs: () =>
      artifactProject.listArtifactRefs.pipe(Effect.mapError(toArtifactProjectRpcError)),
    GetArtifactCapabilities: (request) =>
      artifactProject
        .getArtifactCapabilities(request)
        .pipe(Effect.mapError(toArtifactProjectRpcError)),
    ReadArtifactView: (request) =>
      artifactProject.readArtifactView(request).pipe(Effect.mapError(toArtifactProjectRpcError)),
    ApplyArtifactChange: (change) =>
      artifactProject.applyArtifactChange(change).pipe(Effect.mapError(toArtifactProjectRpcError)),
  });

export const makeSchematicsArtifactProjectRpcLayer = (
  artifactProject: SchematicsArtifactProjectService,
) =>
  SchematicsArtifactProjectRpcGroup.toLayer(
    makeSchematicsArtifactProjectRpcHandlers(artifactProject),
  );
