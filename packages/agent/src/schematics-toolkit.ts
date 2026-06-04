import { Effect, Layer, Schema, Stream } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import type { OpenRouterToolDefinition } from "@schematics/protocol";
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
import {
  ArtifactToolkit,
  ArtifactToolkitLayer,
  GetArtifactCapabilitiesTool,
  ListArtifactsTool,
  ReadArtifactViewTool,
  ValidateArtifactProjectTool,
} from "./artifact-toolkit";
import { JsonToolkit, JsonToolkitLayer } from "./json-toolkit";
import { PdfToolkit, PdfToolkitLayer } from "./pdf-toolkit";
import { SchematicsWorkspaceLayer } from "./schematics-workspace";
import type { SchematicsHostRuntime } from "./types";
import type { ArtifactProjectChangeProvenance } from "@schematics/protocol";

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
export {
  ArtifactToolkit,
  ArtifactToolkitLayer,
  GetArtifactCapabilitiesTool,
  ListArtifactsTool,
  ReadArtifactViewTool,
  ValidateArtifactProjectTool,
  WriteArtifactSourceTool,
} from "./artifact-toolkit";
export { JsonPatchTool, JsonToolkit, JsonToolkitLayer } from "./json-toolkit";
export {
  PdfInspectTool,
  PdfRenderPageScreenshotTool,
  PdfToolkit,
  PdfToolkitLayer,
  PdfUpdateFormAnnotationsTool,
} from "./pdf-toolkit";

export interface SchematicsToolExecution {
  readonly args: Record<string, unknown>;
  readonly result: unknown;
  readonly isError: boolean;
}

export const SchematicsToolkit = Toolkit.merge(
  BaseWorkspaceToolkit,
  ArtifactToolkit,
  JsonToolkit,
  PdfToolkit,
);

export const SchematicsToolkitLayer = Layer.mergeAll(
  BaseWorkspaceToolkitLayer,
  ArtifactToolkitLayer,
  JsonToolkitLayer,
  PdfToolkitLayer,
);

const schematicsTools = Object.values(SchematicsToolkit.tools);
const toolRegistry = new Map<string, Tool.Any>(schematicsTools.map((tool) => [tool.name, tool]));

export const openRouterSchematicsTools: readonly OpenRouterToolDefinition[] = schematicsTools.map(
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
  ListArtifactsTool.name,
  GetArtifactCapabilitiesTool.name,
  ReadArtifactViewTool.name,
  ValidateArtifactProjectTool.name,
  GetJsonSchemaTool.name,
  GetDiagnosticsTool.name,
  ProposePatchTool.name,
]);

export function openRouterSchematicsToolsForMode({
  planMode = false,
}: {
  readonly planMode?: boolean | undefined;
} = {}): readonly OpenRouterToolDefinition[] {
  if (!planMode) return openRouterSchematicsTools;
  return openRouterSchematicsTools.filter((tool) => planModeAllowedTools.has(tool.function.name));
}

export function decodeSchematicsToolArgs(
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

export async function executeSchematicsToolCall(
  tools: SchematicsHostRuntime,
  name: string,
  rawArguments: string,
  options: {
    readonly planMode?: boolean | undefined;
    readonly provenance?: ArtifactProjectChangeProvenance | undefined;
  } = {},
): Promise<SchematicsToolExecution> {
  if (options.planMode && !planModeAllowedTools.has(name)) {
    return {
      args: {},
      result: {
        error: `Tool ${name} is disabled in plan mode. Use propose_patch for edits.`,
      },
      isError: true,
    };
  }

  const decoded = decodeSchematicsToolArgs(name, rawArguments);
  if ("error" in decoded) {
    return { args: decoded.args, result: { error: decoded.error }, isError: true };
  }

  if (!toolRegistry.has(name)) {
    return { args: decoded.args, result: { error: `Unknown tool: ${name}` }, isError: true };
  }

  try {
    const output = await Effect.runPromise(
      Effect.gen(function* () {
        const toolkit = yield* SchematicsToolkit;
        const stream = yield* toolkit.handle(
          name as keyof typeof SchematicsToolkit.tools,
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
        Effect.provide(
          SchematicsToolkitLayer.pipe(
            Layer.provide(SchematicsWorkspaceLayer(tools, { provenance: options.provenance })),
          ),
        ),
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
