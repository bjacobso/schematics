import { Schema } from "effect";
import { ArtifactMatcher, ArtifactType } from "@schematics/artifacts";
import { ArtifactProject, Project } from "@schematics/core";

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
