import type { Action, Workflow } from "@schema-ide/examples";
import type {
  SchemaIdePreviewComponentProps,
  SchemaIdePreviewRegistration,
} from "@schema-ide/react";
import { ExampleIcon, ExamplePreviewShell, InfoGrid, PillList } from "../preview-ui";

export const workflowJsonPreviews = [
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
] satisfies readonly SchemaIdePreviewRegistration[];

function ActionPreview(props: SchemaIdePreviewComponentProps<Action>) {
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

function WorkflowPreview(props: SchemaIdePreviewComponentProps<Workflow>) {
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
