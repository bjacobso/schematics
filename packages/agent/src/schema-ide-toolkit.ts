import { Effect, Layer, Schema, Stream } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import type { OpenRouterToolDefinition } from "@schema-ide/protocol";
import {
  BaseWorkspaceToolkit,
  BaseWorkspaceToolkitLayer,
  GetDiagnosticsTool,
  GetJsonSchemaTool,
  GrepFilesTool,
  ListFilesTool,
  ProposePatchTool,
  ReadFileTool,
  ValidateWorkspaceTool,
} from "./workspace-toolkit";
import { JsonToolkit, JsonToolkitLayer } from "./json-toolkit";
import { PdfToolkit, PdfToolkitLayer } from "./pdf-toolkit";
import { SchemaIdeWorkspaceLayer } from "./schema-ide-workspace";
import type { SchemaIdeHostRuntime } from "./types";

export {
  ApplyEditsTool,
  BaseWorkspaceToolkit,
  BaseWorkspaceToolkitLayer,
  CreateFileTool,
  GetDiagnosticsTool,
  GetJsonSchemaTool,
  GrepFilesTool,
  ListFilesTool,
  ProposePatchTool,
  ReadFileTool,
  ReplaceFileContentTool,
  ValidateWorkspaceTool,
  WriteFileTool,
} from "./workspace-toolkit";
export { JsonPatchTool, JsonToolkit, JsonToolkitLayer } from "./json-toolkit";
export {
  PdfInspectTool,
  PdfRenderPageScreenshotTool,
  PdfToolkit,
  PdfToolkitLayer,
  PdfUpdateFormAnnotationsTool,
} from "./pdf-toolkit";

export interface SchemaIdeToolExecution {
  readonly args: Record<string, unknown>;
  readonly result: unknown;
  readonly isError: boolean;
}

export const SchemaIdeToolkit = Toolkit.merge(BaseWorkspaceToolkit, JsonToolkit, PdfToolkit);

export const SchemaIdeToolkitLayer = Layer.mergeAll(
  BaseWorkspaceToolkitLayer,
  JsonToolkitLayer,
  PdfToolkitLayer,
);

const schemaIdeTools = Object.values(SchemaIdeToolkit.tools);
const toolRegistry = new Map<string, Tool.Any>(schemaIdeTools.map((tool) => [tool.name, tool]));

export const openRouterSchemaIdeTools: readonly OpenRouterToolDefinition[] = schemaIdeTools.map(
  (tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: getToolDescription(tool),
      parameters: getToolJsonSchema(tool),
    },
  }),
);

const planModeAllowedTools: ReadonlySet<string> = new Set([
  ListFilesTool.name,
  ReadFileTool.name,
  GrepFilesTool.name,
  ValidateWorkspaceTool.name,
  GetJsonSchemaTool.name,
  GetDiagnosticsTool.name,
  ProposePatchTool.name,
]);

export function openRouterSchemaIdeToolsForMode({
  planMode = false,
}: {
  readonly planMode?: boolean | undefined;
} = {}): readonly OpenRouterToolDefinition[] {
  if (!planMode) return openRouterSchemaIdeTools;
  return openRouterSchemaIdeTools.filter((tool) => planModeAllowedTools.has(tool.function.name));
}

export function decodeSchemaIdeToolArgs(
  name: string,
  rawArguments: string,
):
  | { readonly args: Record<string, unknown> }
  | { readonly error: string; readonly args: Record<string, unknown> } {
  const tool = toolRegistry.get(name);
  if (!tool) return { error: `Unknown tool: ${name}`, args: {} };

  let raw: unknown;
  try {
    raw = rawArguments.trim() ? JSON.parse(rawArguments) : {};
  } catch (error) {
    return {
      error: `Invalid JSON arguments for ${name}: ${error instanceof Error ? error.message : String(error)}`,
      args: { rawArguments },
    };
  }

  try {
    const args = Schema.decodeUnknownSync(tool.parametersSchema as any)(raw);
    return { args: args as Record<string, unknown> };
  } catch (error) {
    return {
      error: `Invalid arguments for ${name}: ${error instanceof Error ? error.message : String(error)}`,
      args: isRecord(raw) ? raw : { rawArguments },
    };
  }
}

export async function executeSchemaIdeToolCall(
  tools: SchemaIdeHostRuntime,
  name: string,
  rawArguments: string,
  options: { readonly planMode?: boolean | undefined } = {},
): Promise<SchemaIdeToolExecution> {
  if (options.planMode && !planModeAllowedTools.has(name)) {
    return {
      args: {},
      result: {
        error: `Tool ${name} is disabled in plan mode. Use propose_patch for edits.`,
      },
      isError: true,
    };
  }

  const decoded = decodeSchemaIdeToolArgs(name, rawArguments);
  if ("error" in decoded) {
    return { args: decoded.args, result: { error: decoded.error }, isError: true };
  }

  if (!toolRegistry.has(name)) {
    return { args: decoded.args, result: { error: `Unknown tool: ${name}` }, isError: true };
  }

  try {
    const output = await Effect.runPromise(
      Effect.gen(function* () {
        const toolkit = yield* SchemaIdeToolkit;
        const stream = yield* toolkit.handle(
          name as keyof typeof SchemaIdeToolkit.tools,
          decoded.args,
        );
        const results = Array.from(yield* Stream.runCollect(stream));
        return (
          results.findLast((result) => !result.preliminary) ??
          results.at(-1) ?? {
            result: { error: `Tool ${name} did not return a result.` },
            isFailure: true,
          }
        );
      }).pipe(
        Effect.provide(SchemaIdeToolkitLayer.pipe(Layer.provide(SchemaIdeWorkspaceLayer(tools)))),
      ),
    );

    return {
      args: decoded.args,
      result: output.result,
      isError: output.isFailure || isToolError(output.result),
    };
  } catch (error) {
    return {
      args: decoded.args,
      result: { error: error instanceof Error ? error.message : String(error) },
      isError: true,
    };
  }
}

function isToolError(result: unknown): boolean {
  return isRecord(result) && typeof result["error"] === "string";
}

function getToolDescription(tool: Tool.Any): string {
  return Tool.getDescription(tool as any) ?? "";
}

function getToolJsonSchema(tool: Tool.Any): unknown {
  return Tool.getJsonSchema(tool as any);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
