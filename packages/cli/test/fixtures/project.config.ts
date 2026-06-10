import { Schema } from "effect";
import { ArtifactMatcher, ArtifactProject, ArtifactType } from "../../../artifacts/src";

const ActionSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
});

const WorkflowSchema = Schema.Struct({
  id: Schema.String,
  actionIds: Schema.Array(Schema.String),
});

const ActionArtifact = ArtifactType.make("fixture.action").match(ArtifactMatcher.extension("json"));
const WorkflowArtifact = ArtifactType.make("fixture.workflow").match(
  ArtifactMatcher.extension("json"),
);

const Project = ArtifactProject.make("workflow-project-fixture")
  .files("actions/*.json", {
    id: "Actions",
    type: ActionArtifact,
    schema: ActionSchema,
    metadata: {
      attributes: {
        schemaId: "Actions",
        workspaceField: "actions",
        indexBy: "id",
      },
    },
  })
  .files("workflows/*.json", {
    id: "Workflows",
    type: WorkflowArtifact,
    schema: WorkflowSchema,
    metadata: {
      attributes: {
        schemaId: "Workflows",
        workspaceField: "workflows",
        indexBy: "id",
      },
    },
  });

export default {
  project: Project,
  defaultFormat: "json",
  include: ["**/*.json"],
};
