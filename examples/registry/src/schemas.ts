import { Schema } from "effect";
import { ArtifactMatcher, ArtifactType } from "@schema-ide/artifacts";
import { ArtifactProject, Project } from "@schema-ide/core";

export {
  OnboardedArtifactProject,
  OnboardedAccountConfigSchema,
  OnboardedAccountProjectSchema,
  OnboardedAutomationConfigSchema,
  OnboardedCustomPropertyConfigSchema,
  OnboardedFormConfigSchema,
  OnboardedPolicyConfigSchema,
  OnboardedRuleSchema,
  type OnboardedAccountConfig,
  type OnboardedAutomationConfig,
  type OnboardedCustomPropertyConfig,
  type OnboardedFormConfig,
  type OnboardedPolicyConfig,
} from "@schema-ide/onboarded-config";

export const QuestionSchema = Schema.Struct({
  id: Schema.String,
  prompt: Schema.String,
  answerType: Schema.Literals(["text", "single-choice", "multi-choice"]),
});
export type Question = typeof QuestionSchema.Type;

export const SurveySchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  questionIds: Schema.Array(Schema.String),
});
export type Survey = typeof SurveySchema.Type;

export const SurveyQuestionArtifact = ArtifactType.make("survey.question").match(
  ArtifactMatcher.extension("yaml"),
);
export const SurveyDefinitionArtifact = ArtifactType.make("survey.definition").match(
  ArtifactMatcher.extension("yaml"),
);

export const SurveyArtifactProject = ArtifactProject.make("survey-yaml")
  .files("questions/*.yaml", {
    id: "Questions",
    type: SurveyQuestionArtifact,
    schema: QuestionSchema,
    metadata: {
      attributes: {
        schemaId: "Questions",
        workspaceField: "questions",
        description: "Reusable questions",
        indexBy: "id",
        format: "yaml",
      },
    },
  })
  .files("surveys/*.yaml", {
    id: "Surveys",
    type: SurveyDefinitionArtifact,
    schema: SurveySchema,
    metadata: {
      attributes: {
        schemaId: "Surveys",
        workspaceField: "surveys",
        description: "Survey definitions",
        indexBy: "id",
        format: "yaml",
      },
    },
  });

export const SurveyProjectSchema = Project.fromArtifactProject(SurveyArtifactProject).pipe(
  Project.validate<any>("survey question references resolve", ({ surveys, questions }, issue) => {
    for (const survey of surveys.values()) {
      for (const questionId of survey.questionIds) {
        if (!questions.has(questionId)) {
          issue.at(`surveys.${survey.id}.questionIds`, `Unknown question: ${questionId}`);
        }
      }
    }
  }),
);

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
