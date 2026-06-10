import {
  SchematicsArtifactWorkflowRpcGroup,
  type SchematicsArtifactWorkflowService,
} from "@schematics/protocol";

export const makeSchematicsArtifactWorkflowRpcHandlers = (
  artifactWorkflow: SchematicsArtifactWorkflowService,
) =>
  SchematicsArtifactWorkflowRpcGroup.of({
    ListArtifactWorkflowIngestors: () => artifactWorkflow.listIngestors,
    StartArtifactWorkflowRun: (request) => artifactWorkflow.startRun(request),
    WatchArtifactWorkflowRun: (request) => artifactWorkflow.watchRun(request),
    ResumeArtifactWorkflowRun: (request) => artifactWorkflow.resumeRun(request),
    GetArtifactWorkflowRunReport: (request) => artifactWorkflow.getRunReport(request),
  });

export const makeSchematicsArtifactWorkflowRpcLayer = (
  artifactWorkflow: SchematicsArtifactWorkflowService,
) =>
  SchematicsArtifactWorkflowRpcGroup.toLayer(
    makeSchematicsArtifactWorkflowRpcHandlers(artifactWorkflow),
  );
