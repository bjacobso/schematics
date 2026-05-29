import { Schema } from "effect";
import { ArtifactMatcher, ArtifactType } from "@schema-ide/artifacts";
import { ArtifactProject, Workspace } from "@schema-ide/core";

export {
  OnboardedArtifactProject,
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

export const PromptEvalPromptJsonArtifact = ArtifactType.make("prompt-eval.prompt-json").match(
  ArtifactMatcher.extension("json"),
);
export const PromptEvalPromptYamlArtifact = ArtifactType.make("prompt-eval.prompt-yaml").match(
  ArtifactMatcher.extension("yaml"),
);
export const PromptEvalDatasetJsonArtifact = ArtifactType.make("prompt-eval.dataset-json").match(
  ArtifactMatcher.extension("json"),
);
export const PromptEvalDatasetYamlArtifact = ArtifactType.make("prompt-eval.dataset-yaml").match(
  ArtifactMatcher.extension("yaml"),
);
export const PromptEvalEvaluationJsonArtifact = ArtifactType.make(
  "prompt-eval.evaluation-json",
).match(ArtifactMatcher.extension("json"));
export const PromptEvalEvaluationYamlArtifact = ArtifactType.make(
  "prompt-eval.evaluation-yaml",
).match(ArtifactMatcher.extension("yaml"));

export const PromptEvalArtifactProject = ArtifactProject.make("prompt-evals")
  .files("prompts/*.json", {
    id: "PromptFiles",
    type: PromptEvalPromptJsonArtifact,
    schema: PromptSchema,
    metadata: {
      attributes: {
        schemaId: "PromptFiles",
        workspaceField: "prompts",
        description: "JSON prompt definitions",
        indexBy: "id",
        format: "json",
        optional: true,
      },
    },
  })
  .files("prompts/*.yaml", {
    id: "PromptYamlFiles",
    type: PromptEvalPromptYamlArtifact,
    schema: PromptSchema,
    metadata: {
      attributes: {
        schemaId: "PromptYamlFiles",
        workspaceField: "yamlPrompts",
        description: "YAML prompt definitions",
        indexBy: "id",
        format: "yaml",
        optional: true,
      },
    },
  })
  .files("datasets/*.json", {
    id: "DatasetFiles",
    type: PromptEvalDatasetJsonArtifact,
    schema: DatasetSchema,
    metadata: {
      attributes: {
        schemaId: "DatasetFiles",
        workspaceField: "datasets",
        description: "JSON eval datasets",
        indexBy: "id",
        format: "json",
        optional: true,
      },
    },
  })
  .files("datasets/*.yaml", {
    id: "DatasetYamlFiles",
    type: PromptEvalDatasetYamlArtifact,
    schema: DatasetSchema,
    metadata: {
      attributes: {
        schemaId: "DatasetYamlFiles",
        workspaceField: "yamlDatasets",
        description: "YAML eval datasets",
        indexBy: "id",
        format: "yaml",
        optional: true,
      },
    },
  })
  .files("evals/*.json", {
    id: "EvaluationFiles",
    type: PromptEvalEvaluationJsonArtifact,
    schema: EvaluationSchema,
    metadata: {
      attributes: {
        schemaId: "EvaluationFiles",
        workspaceField: "evaluations",
        description: "JSON eval definitions",
        indexBy: "id",
        format: "json",
        optional: true,
      },
    },
  })
  .files("evals/*.yaml", {
    id: "EvaluationYamlFiles",
    type: PromptEvalEvaluationYamlArtifact,
    schema: EvaluationSchema,
    metadata: {
      attributes: {
        schemaId: "EvaluationYamlFiles",
        workspaceField: "yamlEvaluations",
        description: "YAML eval definitions",
        indexBy: "id",
        format: "yaml",
        optional: true,
      },
    },
  });

export const PromptEvalWorkspaceSchema = Workspace.fromArtifactProject(
  PromptEvalArtifactProject,
).pipe(
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

export const SurveyWorkspaceSchema = Workspace.fromArtifactProject(SurveyArtifactProject).pipe(
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

export const WorkflowWorkspaceSchema = Workspace.fromArtifactProject(WorkflowArtifactProject).pipe(
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
