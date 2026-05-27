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
  artifacts: [
    {
      id: "source-html",
      kind: "source",
      path: "sources/:collection/:document/*.html",
      entity: ["collection", "document"],
      contentType: "text/html",
    },
    {
      id: "markdown",
      kind: "generated",
      path: "generated/:collection/:document/document.md",
      entity: ["collection", "document"],
      contentType: "text/markdown",
    },
  ],
  tools: [
    {
      id: "extract-markdown",
      inputs: ["source-html"],
      outputs: ["markdown"],
      uiCallable: true,
      cliCallable: true,
    },
  ],
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
