import {
  PromptEvalArtifactProject,
  type Dataset,
  type Evaluation,
  type Prompt,
} from "@schema-ide/examples";
import Chip from "@mui/material/Chip";
import { ArtifactProjectPreview, type SchemaIdePreviewComponentProps } from "@schema-ide/react";
import {
  EmptyLine,
  ExampleIcon,
  ExamplePreviewShell,
  InfoGrid,
  PillList,
  Section,
} from "../preview-ui";

export const promptEvalsYamlPreviews = ArtifactProjectPreview.make(PromptEvalArtifactProject, [
  {
    id: "prompt-evals-yaml-prompt",
    schemaId: "PromptYamlFiles",
    label: "Prompt",
    component: PromptPreview,
  },
  {
    id: "prompt-evals-yaml-dataset",
    schemaId: "DatasetYamlFiles",
    label: "Dataset",
    component: DatasetPreview,
  },
  {
    id: "prompt-evals-yaml-evaluation",
    schemaId: "EvaluationYamlFiles",
    label: "Evaluation",
    component: EvaluationPreview,
  },
]);

function PromptPreview(props: SchemaIdePreviewComponentProps<Prompt>) {
  const prompt = props.value;
  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="prompt" />}
      title={prompt?.id ?? "Untitled prompt"}
      subtitle={prompt?.description}
      diagnostics={props.diagnostics.length}
    >
      <InfoGrid
        items={[
          ["Model", prompt?.model ?? "Not set"],
          ["Variables", String(prompt?.variables?.length ?? 0)],
          ["File", props.file.path],
        ]}
      />
      <Section title="Template">
        <pre className="whitespace-pre-wrap rounded-lg border bg-background p-3 text-xs leading-relaxed">
          {prompt?.template ?? "No template"}
        </pre>
      </Section>
      <PillList title="Variables" values={prompt?.variables ?? []} empty="No variables declared" />
    </ExamplePreviewShell>
  );
}

function DatasetPreview(props: SchemaIdePreviewComponentProps<Dataset>) {
  const dataset = props.value;
  const cases = dataset?.cases ?? [];
  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="data" />}
      title={dataset?.id ?? "Untitled dataset"}
      subtitle={dataset?.description}
      diagnostics={props.diagnostics.length}
    >
      <InfoGrid
        items={[
          ["Cases", String(cases.length)],
          ["Format", props.format.toUpperCase()],
          ["File", props.file.path],
        ]}
      />
      <Section title="Cases">
        <div className="grid gap-2">
          {cases.length ? (
            cases.map((testCase, index) => (
              <div key={testCase.id ?? index} className="rounded-lg border bg-muted/20 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-xs font-medium">
                    {testCase.id ?? `case-${index + 1}`}
                  </span>
                  <Chip
                    className="ml-auto text-[10px]"
                    label={`Expected: ${testCase.expected ?? "unset"}`}
                    size="small"
                    variant="outlined"
                  />
                </div>
                <div className="text-sm">{testCase.input ?? "No input"}</div>
              </div>
            ))
          ) : (
            <EmptyLine>No cases defined</EmptyLine>
          )}
        </div>
      </Section>
    </ExamplePreviewShell>
  );
}

function EvaluationPreview(props: SchemaIdePreviewComponentProps<Evaluation>) {
  const evaluation = props.value;
  return (
    <ExamplePreviewShell
      icon={<ExampleIcon label="eval" />}
      title={evaluation?.title ?? evaluation?.id ?? "Untitled evaluation"}
      subtitle={evaluation?.id}
      diagnostics={props.diagnostics.length}
    >
      <InfoGrid
        items={[
          ["Prompt", evaluation?.promptId ?? "Not set"],
          ["Dataset", evaluation?.datasetId ?? "Not set"],
          ["Checks", String(evaluation?.checks?.length ?? 0)],
        ]}
      />
      <PillList
        title="Required variables"
        values={evaluation?.requiredVariables ?? []}
        empty="No required variables"
      />
      <PillList title="Checks" values={evaluation?.checks ?? []} empty="No checks" />
    </ExamplePreviewShell>
  );
}
