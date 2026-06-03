import type {
  SchematicsChatAdapter,
  SchematicsChatMessage,
  SchematicsToolCall,
  SchematicsHostRuntime,
} from "./types";
import type { SchematicsReflection, SourceFile } from "@schematics/core";

export interface SchematicsChatEvalFixture {
  readonly name: string;
  readonly prompt: string;
  readonly reflection: SchematicsReflection;
  readonly files: readonly SourceFile[];
  readonly expectedFiles?: readonly SourceFile[] | undefined;
  readonly history?: readonly SchematicsChatMessage[] | undefined;
  readonly model?: string | undefined;
  readonly planMode?: boolean | undefined;
}

export interface SchematicsChatEvalResult {
  readonly name: string;
  readonly passed: boolean;
  readonly message: SchematicsChatMessage;
  readonly toolCalls: readonly SchematicsToolCall[];
  readonly files: readonly SourceFile[];
  readonly mismatches: readonly string[];
}

export async function runSchematicsChatEval({
  fixture,
  chat,
  tools,
  getFiles,
}: {
  readonly fixture: SchematicsChatEvalFixture;
  readonly chat: SchematicsChatAdapter;
  readonly tools: SchematicsHostRuntime;
  readonly getFiles: () => readonly SourceFile[];
}): Promise<SchematicsChatEvalResult> {
  const toolCalls: SchematicsToolCall[] = [];
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
