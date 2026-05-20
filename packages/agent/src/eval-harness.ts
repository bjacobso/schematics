import type {
  SchemaIdeChatAdapter,
  SchemaIdeChatMessage,
  SchemaIdeToolCall,
  SchemaIdeHostRuntime,
} from "./types";
import type { SchemaIdeReflection, SourceFile } from "@schema-ide/core";

export interface SchemaIdeChatEvalFixture {
  readonly name: string;
  readonly prompt: string;
  readonly reflection: SchemaIdeReflection;
  readonly files: readonly SourceFile[];
  readonly expectedFiles?: readonly SourceFile[] | undefined;
  readonly history?: readonly SchemaIdeChatMessage[] | undefined;
  readonly model?: string | undefined;
  readonly planMode?: boolean | undefined;
}

export interface SchemaIdeChatEvalResult {
  readonly name: string;
  readonly passed: boolean;
  readonly message: SchemaIdeChatMessage;
  readonly toolCalls: readonly SchemaIdeToolCall[];
  readonly files: readonly SourceFile[];
  readonly mismatches: readonly string[];
}

export async function runSchemaIdeChatEval({
  fixture,
  chat,
  tools,
  getFiles,
}: {
  readonly fixture: SchemaIdeChatEvalFixture;
  readonly chat: SchemaIdeChatAdapter;
  readonly tools: SchemaIdeHostRuntime;
  readonly getFiles: () => readonly SourceFile[];
}): Promise<SchemaIdeChatEvalResult> {
  const toolCalls: SchemaIdeToolCall[] = [];
  const result = await chat.send({
    message: fixture.prompt,
    history: fixture.history ?? [],
    reflection: fixture.reflection,
    tools,
    model: fixture.model,
    planMode: fixture.planMode,
    onToolCall: (toolCall) => toolCalls.push(toolCall),
  }).promise;
  const files = getFiles();
  const mismatches = fixture.expectedFiles ? compareFiles(fixture.expectedFiles, files) : [];

  return {
    name: fixture.name,
    passed: mismatches.length === 0 && !toolCalls.some((call) => call.status === "error"),
    message: result.message,
    toolCalls,
    files,
    mismatches,
  };
}

function compareFiles(
  expected: readonly SourceFile[],
  actual: readonly SourceFile[],
): readonly string[] {
  const mismatches: string[] = [];
  const expectedByPath = new Map(expected.map((file) => [file.path, file.content]));
  const actualByPath = new Map(actual.map((file) => [file.path, file.content]));

  for (const [path, content] of expectedByPath) {
    if (!actualByPath.has(path)) {
      mismatches.push(`Missing file: ${path}`);
    } else if (actualByPath.get(path) !== content) {
      mismatches.push(`Content mismatch: ${path}`);
    }
  }

  for (const path of actualByPath.keys()) {
    if (!expectedByPath.has(path)) mismatches.push(`Unexpected file: ${path}`);
  }

  return mismatches;
}
