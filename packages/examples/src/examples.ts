import type { SourceFile } from "@schema-ide/core";
import type { WorkspaceSchema } from "@schema-ide/core";
import {
  PromptEvalWorkspaceSchema,
  SurveyWorkspaceSchema,
  WorkflowWorkspaceSchema,
} from "./schemas";

const intakePdfExample =
  "JVBERi0xLjcKJYGBgYEKCjYgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL0xlbmd0aCAxOTQKPj4Kc3RyZWFtCnicbY7BSgQwDETv+YqeBTVNk0kK4kG3iwcvQn9AZF0UPayI32/KsqAiTWcYmJB3oJtJfFGlpESKoHzs6fJu9/a1+3x5ejx37qHBHr2IlvlMS++pFs5Xi0sOl/lOV9bQEDBsUIW1q6oJG6cjs3mgYuOMW9h1ma80z2hMeqDDEUIs77f14w9DdxWEGKIk6X8MCD0x9NMNYWwx0leucPygAbJ37ABbl/SO4S2bhuaaKXdl7Q2osK++ua8WXMYv/m83sEZRCmVuZHN0cmVhbQplbmRvYmoKCjcgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL1R5cGUgL09ialN0bQovTiA1Ci9GaXJzdCAyNgovTGVuZ3RoIDM3NAo+PgpzdHJlYW0KeJzVUt9LwzAQfs9fcY/6IEnTNGllDParCjKUTVAUH7o2jMpIpM1k/vfetZ1jD+KzlCO5u+8u3/W+CARIUApiMCkoSGIJCZg4g9GI8cevDwv8odjalvG7umrhFTECVvDG+MzvXYCIjcfshJ0Vodj5LeuLICLwEfHQ+Gpf2gZG+SLPhTBCCK3QtBByjucMLUOT6GNOpnhHM2owjJlYiHiCubw3bfoaynfYZKhf4IlYTZh5j1Vp7/+8S28t+h7yLz7ZmPGlr+ZFsHAxv5ZCapFEmYyVUdHLJf6OxhbB/9/hOv61d79OeLZnWi8tubGkgW7LfGVbv29KXDvhco8Zutza3acNdVlcGZGlyNOkGWqsKznlMqOkTmWi0yGHz/Hn+827Lbs25C4O4WYdiF8foNjSVnUx9QdUpsBPRxJMJkmfE+d8IMV2WnUBmZKnB/2ejUNkGV/vN6FzKRgxPi1a241x4okkXOmr2m2BP9Vu4tr6GKCO38XozTEKZW5kc3RyZWFtCmVuZG9iagoKOCAwIG9iago8PAovU2l6ZSA5Ci9Sb290IDIgMCBSCi9JbmZvIDMgMCBSCi9GaWx0ZXIgL0ZsYXRlRGVjb2RlCi9UeXBlIC9YUmVmCi9MZW5ndGggNDEKL1cgWyAxIDIgMiBdCi9JbmRleCBbIDAgOSBdCj4+CnN0cmVhbQp4nBXEsREAIAwDsbfDHS09+89ImWAVArrNhqTkVGmJA9L9+cEAXWgDXgplbmRzdHJlYW0KZW5kb2JqCgpzdGFydHhyZWYKNzU5CiUlRU9G";

export interface SchemaIdeExample {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly schema: WorkspaceSchema<unknown>;
  readonly files: readonly SourceFile[];
  readonly defaultFormat?: "json" | "yaml" | undefined;
  readonly suggestedPrompts?: readonly string[] | undefined;
}

export const schemaIdeExamples: readonly SchemaIdeExample[] = [
  {
    id: "prompt-evals-json",
    name: "Prompt Evals (JSON)",
    description: "Prompt definitions reference datasets and required template variables.",
    schema: PromptEvalWorkspaceSchema,
    defaultFormat: "json",
    suggestedPrompts: ["Fix the broken eval reference", "Add a regression dataset"],
    files: [
      {
        path: "prompts/support-router.json",
        content: JSON.stringify(
          {
            id: "support-router",
            description: "Route support requests to the right queue.",
            model: "~openai/gpt-latest",
            variables: ["ticket", "queues"],
            template: "Classify {{ticket}} into one of {{queues}}.",
          },
          null,
          2,
        ),
      },
      {
        path: "datasets/support-tickets.json",
        content: JSON.stringify(
          {
            id: "support-tickets",
            description: "Representative support routing cases.",
            cases: [
              {
                id: "refund-request",
                input: "I was charged twice for my subscription.",
                expected: "billing",
              },
            ],
          },
          null,
          2,
        ),
      },
      {
        path: "evals/support-routing.json",
        content: JSON.stringify(
          {
            id: "support-routing",
            title: "Support routing regression",
            promptId: "support-router",
            datasetId: "missing-support-tickets",
            requiredVariables: ["ticket", "queues"],
            checks: ["contains"],
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: "prompt-evals-yaml",
    name: "Prompt Evals (YAML)",
    description: "The same prompt/eval workspace using YAML files.",
    schema: PromptEvalWorkspaceSchema,
    defaultFormat: "yaml",
    suggestedPrompts: ["Explain the cross-file validation error", "Add the missing variable"],
    files: [
      {
        path: "prompts/release-notes.yaml",
        content: [
          "id: release-notes",
          "description: Draft concise release notes from merged changes.",
          "model: ~anthropic/claude-sonnet-latest",
          "variables:",
          "  - changes",
          "template: |",
          "  Write release notes for {{changes}}.",
          "",
        ].join("\n"),
      },
      {
        path: "datasets/release-changes.yaml",
        content: [
          "id: release-changes",
          "description: Small release note examples.",
          "cases:",
          "  - id: validation-copy",
          "    input: Added clearer validation errors.",
          "    expected: validation errors",
          "",
        ].join("\n"),
      },
      {
        path: "evals/release-notes.yaml",
        content: [
          "id: release-notes",
          "title: Release notes quality check",
          "promptId: release-notes",
          "datasetId: release-changes",
          "requiredVariables:",
          "  - changes",
          "  - tone",
          "checks:",
          "  - contains",
          "",
        ].join("\n"),
      },
    ],
  },
  {
    id: "survey-yaml",
    name: "Survey Builder (YAML)",
    description: "Surveys reference reusable question files.",
    schema: SurveyWorkspaceSchema,
    defaultFormat: "yaml",
    suggestedPrompts: ["Create a missing question file", "Summarize the survey schema"],
    files: [
      {
        path: "questions/name.yaml",
        content: "id: name\nprompt: What is your name?\nanswerType: text\n",
      },
      {
        path: "questions/email.yaml",
        content: "id: email\nprompt: What is your email address?\nanswerType: text\n",
      },
      {
        path: "surveys/intake.yaml",
        content: "id: intake\ntitle: Intake Survey\nquestionIds:\n  - name\n  - email\n",
      },
      {
        path: "forms/intake.pdf",
        content: intakePdfExample,
      },
    ],
  },
  {
    id: "workflow-json",
    name: "Workflow Config (JSON)",
    description: "Workflows reference action definitions.",
    schema: WorkflowWorkspaceSchema,
    defaultFormat: "json",
    suggestedPrompts: ["Add the missing webhook action", "Find workflow validation issues"],
    files: [
      {
        path: "actions/notify-channel.json",
        content: JSON.stringify(
          { id: "notify-channel", kind: "email", label: "Notify release channel" },
          null,
          2,
        ),
      },
      {
        path: "workflows/release-checklist.json",
        content: JSON.stringify(
          {
            id: "release-checklist",
            name: "Release checklist",
            actionIds: ["notify-channel", "publish-changelog"],
          },
          null,
          2,
        ),
      },
    ],
  },
];

export function randomSchemaIdeExample(): SchemaIdeExample {
  return (
    schemaIdeExamples[Math.floor(Math.random() * schemaIdeExamples.length)] ?? schemaIdeExamples[0]!
  );
}
