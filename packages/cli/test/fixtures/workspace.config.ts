import { Schema } from "effect";
import { Project } from "../../../core/src";

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
  schema: Project.Struct({
    actions: Project.files("actions/*.json", ActionSchema).pipe(
      Project.annotations({ identifier: "Actions" }),
      Project.indexBy("id"),
    ),
    workflows: Project.files("workflows/*.json", WorkflowSchema).pipe(
      Project.annotations({ identifier: "Workflows" }),
      Project.indexBy("id"),
    ),
  }).pipe(
    Project.validate<any>("workflow action references resolve", ({ actions, workflows }, issue) => {
      for (const workflow of workflows.values()) {
        for (const actionId of workflow.actionIds) {
          if (!actions.has(actionId)) {
            issue.at(`workflows.${workflow.id}.actionIds`, `Unknown action: ${actionId}`);
          }
        }
      }
    }),
  ),
};
