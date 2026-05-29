import { Schema } from "effect";
import { ArtifactMatcher, ArtifactProject, ArtifactType } from "@schema-ide/artifacts";
import { Workspace, createWorkspaceFromArtifactProject } from "@schema-ide/core";

export {
  OnboardedAccountConfigSchema,
  OnboardedAccountWorkspaceSchema,
  OnboardedAttributeCatalogSchema,
  OnboardedAutomationConfigSchema,
  OnboardedDocumentConfigSchema,
  OnboardedFormConfigSchema,
  OnboardedFormSubscriptionSchema,
  OnboardedImportManifestSchema,
  OnboardedPdfAnnotationSchema,
  OnboardedPdfAnnotationDocumentSchema,
  OnboardedPdfInspectFieldSchema,
  OnboardedPdfInspectSchema,
  OnboardedPdfMappingConfigSchema,
  OnboardedPolicyConfigSchema,
  OnboardedRuleSchema,
  type OnboardedAccountConfig,
  type OnboardedAttributeCatalog,
  type OnboardedAttributeDefinition,
  type OnboardedAutomationConfig,
  type OnboardedAutomationStep,
  type OnboardedDocumentConfig,
  type OnboardedFormConfig,
  type OnboardedFormSubscription,
  type OnboardedImportManifest,
  type OnboardedPdfAnnotation,
  type OnboardedPdfAnnotationDocument,
  type OnboardedPdfInspectField,
  type OnboardedPdfInspect,
  type OnboardedPdfMappingConfig,
  type OnboardedPdfMappingEntry,
  type OnboardedPolicyConfig,
} from "@schema-ide/onboarded-config";

export const PromptSchema = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  model: Schema.String,
  variables: Schema.Array(Schema.String),
  template: Schema.String,
});
export type Prompt = typeof PromptSchema.Type;

export const DatasetCaseSchema = Schema.Struct({
  id: Schema.String,
  input: Schema.String,
  expected: Schema.String,
});
export const DatasetSchema = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  cases: Schema.Array(DatasetCaseSchema),
});
export type Dataset = typeof DatasetSchema.Type;

export const EvaluationSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  promptId: Schema.String,
  datasetId: Schema.String,
  requiredVariables: Schema.Array(Schema.String),
  checks: Schema.Array(Schema.Literals(["contains", "exact-match", "json-schema"])),
});
export type Evaluation = typeof EvaluationSchema.Type;

export const PromptEvalWorkspaceSchema = Workspace.Struct({
  prompts: Workspace.files("prompts/*.json", PromptSchema, { optional: true }).pipe(
    Workspace.annotations({ identifier: "PromptFiles", description: "JSON prompt definitions" }),
    Workspace.indexBy("id"),
  ),
  yamlPrompts: Workspace.files("prompts/*.yaml", PromptSchema, { optional: true }).pipe(
    Workspace.annotations({
      identifier: "PromptYamlFiles",
      description: "YAML prompt definitions",
    }),
    Workspace.indexBy("id"),
  ),
  datasets: Workspace.files("datasets/*.json", DatasetSchema, { optional: true }).pipe(
    Workspace.annotations({ identifier: "DatasetFiles", description: "JSON eval datasets" }),
    Workspace.indexBy("id"),
  ),
  yamlDatasets: Workspace.files("datasets/*.yaml", DatasetSchema, { optional: true }).pipe(
    Workspace.annotations({ identifier: "DatasetYamlFiles", description: "YAML eval datasets" }),
    Workspace.indexBy("id"),
  ),
  evaluations: Workspace.files("evals/*.json", EvaluationSchema, { optional: true }).pipe(
    Workspace.annotations({ identifier: "EvaluationFiles", description: "JSON eval definitions" }),
    Workspace.indexBy("id"),
  ),
  yamlEvaluations: Workspace.files("evals/*.yaml", EvaluationSchema, { optional: true }).pipe(
    Workspace.annotations({
      identifier: "EvaluationYamlFiles",
      description: "YAML eval definitions",
    }),
    Workspace.indexBy("id"),
  ),
}).pipe(
  Workspace.transform((workspace: any) => ({
    prompts: mergeMaps(workspace.prompts, workspace.yamlPrompts),
    datasets: mergeMaps(workspace.datasets, workspace.yamlDatasets),
    evaluations: mergeMaps(workspace.evaluations, workspace.yamlEvaluations),
  })),
  Workspace.validate<any>(
    "prompt eval references resolve",
    ({ prompts, datasets, evaluations }, issue) => {
      if (prompts.size === 0) {
        issue.at("prompts", "At least one prompt file is required");
      }

      if (datasets.size === 0) {
        issue.at("datasets", "At least one dataset file is required");
      }

      if (evaluations.size === 0) {
        issue.at("evals", "At least one eval file is required");
      }

      for (const evaluation of evaluations.values()) {
        const prompt = prompts.get(evaluation.promptId);
        if (!prompt) {
          issue.at(`evals.${evaluation.id}.promptId`, `Unknown prompt: ${evaluation.promptId}`);
        } else {
          for (const variable of evaluation.requiredVariables) {
            if (!prompt.variables.includes(variable)) {
              issue.at(
                `evals.${evaluation.id}.requiredVariables`,
                `Unknown required variable ${variable} on prompt ${evaluation.promptId}`,
              );
            }
          }
        }

        if (!datasets.has(evaluation.datasetId)) {
          issue.at(`evals.${evaluation.id}.datasetId`, `Unknown dataset: ${evaluation.datasetId}`);
        }
      }
    },
  ),
);

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

export const SurveyWorkspaceSchema = createWorkspaceFromArtifactProject(SurveyArtifactProject).pipe(
  Workspace.validate<any>("survey question references resolve", ({ surveys, questions }, issue) => {
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

export const WorkflowWorkspaceSchema = createWorkspaceFromArtifactProject(
  WorkflowArtifactProject,
).pipe(
  Workspace.validate<any>("workflow action references resolve", ({ workflows, actions }, issue) => {
    for (const workflow of workflows.values()) {
      for (const actionId of workflow.actionIds) {
        if (!actions.has(actionId)) {
          issue.at(`workflows.${workflow.id}.actionIds`, `Unknown action: ${actionId}`);
        }
      }
    }
  }),
);

function mergeMaps<K, V>(left: ReadonlyMap<K, V>, right: ReadonlyMap<K, V>): Map<K, V> {
  return new Map([...left.entries(), ...right.entries()]);
}
