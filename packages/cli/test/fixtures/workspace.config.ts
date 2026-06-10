import { Effect, Schema } from "effect";
import { Project } from "../../../core/src";

const ActionSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
});

const WorkflowSchema = Schema.Struct({
  id: Schema.String,
  actionIds: Schema.Array(Schema.String),
});

const AddActionInput = Schema.Struct({
  sourcePath: Schema.String,
  id: Schema.String,
  label: Schema.String,
});

const AddActionOutput = Schema.Struct({
  path: Schema.String,
});

const emitAction = {
  id: "workflow-fixture.emitAction",
  input: AddActionInput,
  output: AddActionOutput,
  uses: [],
  mode: "deterministic" as const,
  validateAfterWrite: true,
  run: ({ input, writeFile }) =>
    writeFile(
      "actions/generated.json",
      `${JSON.stringify({ id: input.id, label: input.label })}\n`,
    ).pipe(Effect.as({ path: "actions/generated.json" })),
};

const addActionWorkflow = {
  id: "workflow-fixture.addAction",
  input: AddActionInput,
  output: AddActionOutput,
  order: ["emit"],
  uses: [],
  steps: {
    emit: { action: emitAction, after: [] },
  },
  outputFromSteps: (outputs: Readonly<Record<string, unknown>>) =>
    outputs["emit"] as typeof AddActionOutput.Type,
};

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
  ingestors: [
    {
      id: "workflow-fixture.action.fromText",
      label: "Add action from text",
      accepts: [{ extension: "txt", mimeType: "text/plain" }],
      targetRoutes: ["Actions"],
      creates: ["actions/*.json"],
      inputs: AddActionInput,
      write: "apply",
      workflow: addActionWorkflow,
      uses: [],
    },
  ],
};
