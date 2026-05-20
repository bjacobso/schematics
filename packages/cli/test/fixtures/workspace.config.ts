import { Schema } from "effect";
import { Workspace } from "../../../core/src";

const ActionSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
});

const WorkflowSchema = Schema.Struct({
  id: Schema.String,
  actionIds: Schema.Array(Schema.String),
});

export default {
  id: "workflow-fixture",
  defaultFormat: "json",
  schema: Workspace.Struct({
    actions: Workspace.files("actions/*.json", ActionSchema).pipe(
      Workspace.annotations({ identifier: "Actions" }),
      Workspace.indexBy("id"),
    ),
    workflows: Workspace.files("workflows/*.json", WorkflowSchema).pipe(
      Workspace.annotations({ identifier: "Workflows" }),
      Workspace.indexBy("id"),
    ),
  }).pipe(
    Workspace.validate<any>(
      "workflow action references resolve",
      ({ actions, workflows }, issue) => {
        for (const workflow of workflows.values()) {
          for (const actionId of workflow.actionIds) {
            if (!actions.has(actionId)) {
              issue.at(`workflows.${workflow.id}.actionIds`, `Unknown action: ${actionId}`);
            }
          }
        }
      },
    ),
  ),
};
