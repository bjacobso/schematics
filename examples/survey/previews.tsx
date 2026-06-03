import { SurveyArtifactProject, type Question, type Survey } from "@schema-ide/examples";
import { ArtifactProjectPreview, type SchemaIdePreviewComponentProps } from "@schema-ide/react";
import { ExampleIcon, ExamplePreviewShell, PillList, Section } from "../preview-ui";

export const surveyYamlPreviews = ArtifactProjectPreview.make(SurveyArtifactProject, [
  {
    id: "survey-yaml-question",
    schemaId: "Questions",
    label: "Question",
    component: QuestionPreview,
  },
  {
    id: "survey-yaml-survey",
    schemaId: "Surveys",
    label: "Survey",
    component: SurveyPreview,
  },
]);

function QuestionPreview(props: SchemaIdePreviewComponentProps<Question>) {
  const question = props.value;
  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="question" />}
      title={question?.id ?? "Untitled question"}
      subtitle={question?.answerType}
      diagnostics={props.diagnostics.length}
    >
      <Section title="Prompt">
        <div className="rounded-lg border bg-muted/20 p-4 text-sm">
          {question?.prompt ?? "No prompt"}
        </div>
      </Section>
    </ExamplePreviewShell>
  );
}

function SurveyPreview(props: SchemaIdePreviewComponentProps<Survey>) {
  const survey = props.value;
  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="survey" />}
      title={survey?.title ?? survey?.id ?? "Untitled survey"}
      subtitle={survey?.id}
      diagnostics={props.diagnostics.length}
    >
      <PillList
        title="Question order"
        values={survey?.questionIds ?? []}
        empty="No questions selected"
      />
    </ExamplePreviewShell>
  );
}
