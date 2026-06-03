import { WorkflowArtifactProject, type Action, type Workflow } from "@schematics/example-workflow";
import { ArtifactProjectPreview, type SchematicsPreviewComponentProps } from "@schematics/ide";
import { ExampleIcon, ExamplePreviewShell, InfoGrid, PillList } from "@schematics/example-ui";

export const workflowJsonPreviews = ArtifactProjectPreview.make(WorkflowArtifactProject, [
  {
    id: "workflow-json-action",
    schemaId: "Actions",
    label: "Action",
    component: ActionPreview,
  },
  {
    id: "workflow-json-workflow",
    schemaId: "Workflows",
    label: "Workflow",
    component: WorkflowPreview,
  },
]);

function ActionPreview(props: SchematicsPreviewComponentProps<Action>) {
  const action = props.value;
  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="action" />}
      title={action?.label ?? action?.id ?? "Untitled action"}
      subtitle={action?.id}
      diagnostics={props.diagnostics.length}
    >
      <InfoGrid
        items={[
          ["Kind", action?.kind ?? "Not set"],
          ["ID", action?.id ?? "Not set"],
          ["File", props.file.path],
        ]}
      />
    </ExamplePreviewShell>
  );
}

function WorkflowPreview(props: SchematicsPreviewComponentProps<Workflow>) {
  const workflow = props.value;
  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="workflow" />}
      title={workflow?.name ?? workflow?.id ?? "Untitled workflow"}
      subtitle={workflow?.id}
      diagnostics={props.diagnostics.length}
    >
      <PillList title="Actions" values={workflow?.actionIds ?? []} empty="No actions configured" />
    </ExamplePreviewShell>
  );
}
