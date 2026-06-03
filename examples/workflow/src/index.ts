import { Schema } from "effect";
import { ArtifactMatcher, ArtifactType } from "@schematics/artifacts";
import { ArtifactProject, Project } from "@schematics/core";

export const ActionSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["email", "task", "webhook"]),
  label: Schema.String,
});
export type Action = typeof ActionSchema.Type;

export const WorkflowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  actionIds: Schema.Array(Schema.String),
});
export type Workflow = typeof WorkflowSchema.Type;

export const WorkflowActionArtifact = ArtifactType.make("workflow.action").match(
  ArtifactMatcher.extension("json"),
);
export const WorkflowDefinitionArtifact = ArtifactType.make("workflow.definition").match(
  ArtifactMatcher.extension("json"),
);

export const WorkflowArtifactProject = ArtifactProject.make("workflow-json")
  .files("actions/*.json", {
    id: "Actions",
    type: WorkflowActionArtifact,
    schema: ActionSchema,
    metadata: {
      attributes: {
        schemaId: "Actions",
        workspaceField: "actions",
        description: "Workflow actions",
        indexBy: "id",
      },
    },
  })
  .files("workflows/*.json", {
    id: "Workflows",
    type: WorkflowDefinitionArtifact,
    schema: WorkflowSchema,
    metadata: {
      attributes: {
        schemaId: "Workflows",
        workspaceField: "workflows",
        description: "Workflow definitions",
        indexBy: "id",
      },
    },
  });

export const WorkflowProjectSchema = Project.fromArtifactProject(WorkflowArtifactProject).pipe(
  Project.validate<any>("workflow action references resolve", ({ workflows, actions }, issue) => {
    for (const workflow of workflows.values()) {
      for (const actionId of workflow.actionIds) {
        if (!actions.has(actionId)) {
          issue.at(`workflows.${workflow.id}.actionIds`, `Unknown action: ${actionId}`);
        }
      }
    }
  }),
);
