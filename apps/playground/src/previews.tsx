import { Bot, CheckCircle2, ClipboardList, Database, GitBranch, ListChecks } from "lucide-react";
import type { ReactNode } from "react";
import type {
  Action,
  Dataset,
  Evaluation,
  Prompt,
  Question,
  Survey,
  Workflow,
} from "@schema-ide/examples";
import type {
  SchemaIdePreviewComponentProps,
  SchemaIdePreviewRegistration,
} from "@schema-ide/react";
import { Badge, ScrollArea } from "@schema-ide/ui";

export const playgroundPreviews = [
  {
    id: "prompt-summary",
    schemaId: "PromptFiles",
    label: "Prompt",
    component: PromptPreview,
  },
  {
    id: "prompt-yaml-summary",
    schemaId: "PromptYamlFiles",
    label: "Prompt",
    component: PromptPreview,
  },
  {
    id: "dataset-summary",
    schemaId: "DatasetFiles",
    label: "Dataset",
    component: DatasetPreview,
  },
  {
    id: "dataset-yaml-summary",
    schemaId: "DatasetYamlFiles",
    label: "Dataset",
    component: DatasetPreview,
  },
  {
    id: "evaluation-summary",
    schemaId: "EvaluationFiles",
    label: "Evaluation",
    component: EvaluationPreview,
  },
  {
    id: "evaluation-yaml-summary",
    schemaId: "EvaluationYamlFiles",
    label: "Evaluation",
    component: EvaluationPreview,
  },
  {
    id: "question-summary",
    schemaId: "Questions",
    label: "Question",
    component: QuestionPreview,
  },
  {
    id: "survey-summary",
    schemaId: "Surveys",
    label: "Survey",
    component: SurveyPreview,
  },
  {
    id: "action-summary",
    schemaId: "Actions",
    label: "Action",
    component: ActionPreview,
  },
  {
    id: "workflow-summary",
    schemaId: "Workflows",
    label: "Workflow",
    component: WorkflowPreview,
  },
] satisfies readonly SchemaIdePreviewRegistration[];

function PromptPreview(props: SchemaIdePreviewComponentProps<Prompt>) {
  const prompt = props.value;
  return (
    <PreviewShell
      icon={<Bot className="size-4" />}
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
    </PreviewShell>
  );
}

function DatasetPreview(props: SchemaIdePreviewComponentProps<Dataset>) {
  const dataset = props.value;
  const cases = dataset?.cases ?? [];
  return (
    <PreviewShell
      icon={<Database className="size-4" />}
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
                  <Badge variant="outline" className="ml-auto text-[10px]">
                    Expected: {testCase.expected ?? "unset"}
                  </Badge>
                </div>
                <div className="text-sm">{testCase.input ?? "No input"}</div>
              </div>
            ))
          ) : (
            <EmptyLine>No cases defined</EmptyLine>
          )}
        </div>
      </Section>
    </PreviewShell>
  );
}

function EvaluationPreview(props: SchemaIdePreviewComponentProps<Evaluation>) {
  const evaluation = props.value;
  return (
    <PreviewShell
      icon={<ListChecks className="size-4" />}
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
    </PreviewShell>
  );
}

function QuestionPreview(props: SchemaIdePreviewComponentProps<Question>) {
  const question = props.value;
  return (
    <PreviewShell
      icon={<ClipboardList className="size-4" />}
      title={question?.id ?? "Untitled question"}
      subtitle={question?.answerType}
      diagnostics={props.diagnostics.length}
    >
      <Section title="Prompt">
        <div className="rounded-lg border bg-muted/20 p-4 text-sm">
          {question?.prompt ?? "No prompt"}
        </div>
      </Section>
    </PreviewShell>
  );
}

function SurveyPreview(props: SchemaIdePreviewComponentProps<Survey>) {
  const survey = props.value;
  return (
    <PreviewShell
      icon={<ClipboardList className="size-4" />}
      title={survey?.title ?? survey?.id ?? "Untitled survey"}
      subtitle={survey?.id}
      diagnostics={props.diagnostics.length}
    >
      <PillList
        title="Question order"
        values={survey?.questionIds ?? []}
        empty="No questions selected"
      />
    </PreviewShell>
  );
}

function ActionPreview(props: SchemaIdePreviewComponentProps<Action>) {
  const action = props.value;
  return (
    <PreviewShell
      icon={<CheckCircle2 className="size-4" />}
      title={action?.label ?? action?.id ?? "Untitled action"}
      subtitle={action?.id}
      diagnostics={props.diagnostics.length}
    >
      <InfoGrid
        items={[
          ["Kind", action?.kind ?? "Not set"],
          ["ID", action?.id ?? "Not set"],
          ["File", props.file.path],
        ]}
      />
    </PreviewShell>
  );
}

function WorkflowPreview(props: SchemaIdePreviewComponentProps<Workflow>) {
  const workflow = props.value;
  return (
    <PreviewShell
      icon={<GitBranch className="size-4" />}
      title={workflow?.name ?? workflow?.id ?? "Untitled workflow"}
      subtitle={workflow?.id}
      diagnostics={props.diagnostics.length}
    >
      <PillList title="Actions" values={workflow?.actionIds ?? []} empty="No actions configured" />
    </PreviewShell>
  );
}

function PreviewShell({
  icon,
  title,
  subtitle,
  diagnostics,
  children,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly diagnostics: number;
  readonly children: ReactNode;
}) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="grid max-w-3xl gap-4 p-4">
        <div className="rounded-lg border bg-muted/20 p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-md border bg-background p-2 text-primary">{icon}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold">{title}</div>
              {subtitle ? (
                <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>
              ) : null}
            </div>
            {diagnostics ? (
              <Badge variant="destructive" className="text-[10px]">
                {diagnostics} issue{diagnostics === 1 ? "" : "s"}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">
                Valid
              </Badge>
            )}
          </div>
        </div>
        {children}
      </div>
    </ScrollArea>
  );
}

function InfoGrid({ items }: { readonly items: readonly (readonly [string, string])[] }) {
  return (
    <div className="grid gap-2 md:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border bg-background p-3">
          <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
          <div className="mt-1 truncate text-sm font-medium">{value}</div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function PillList({
  title,
  values,
  empty,
}: {
  readonly title: string;
  readonly values: readonly string[];
  readonly empty: string;
}) {
  return (
    <Section title={title}>
      {values.length ? (
        <div className="flex flex-wrap gap-2">
          {values.map((value) => (
            <Badge key={value} variant="outline">
              {value}
            </Badge>
          ))}
        </div>
      ) : (
        <EmptyLine>{empty}</EmptyLine>
      )}
    </Section>
  );
}

function EmptyLine({ children }: { readonly children: ReactNode }) {
  return (
    <div className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">
      {children}
    </div>
  );
}
