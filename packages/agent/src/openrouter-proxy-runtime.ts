import type {
  SchematicsChatAdapter,
  SchematicsChatMessage,
  SchematicsChatResult,
  SchematicsChatTurnInput,
} from "./types";
import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import {
  OpenRouterChatCompletionResponseSchema,
  SCHEMATICS_DEFAULT_OPENROUTER_MODEL,
  SCHEMATICS_OPENROUTER_MODELS,
  type OpenRouterAssistantResponseMessage,
  type OpenRouterChatRequest,
  type OpenRouterMessage,
  type OpenRouterToolCall,
} from "@schematics/protocol";
import { SchematicsHttpApi } from "@schematics/protocol";
import {
  decodeSchematicsToolArgs,
  executeSchematicsToolCall,
  openRouterSchematicsToolsForMode,
} from "./schematics-toolkit";

export interface OpenRouterProxyChatAdapterOptions {
  readonly proxyUrl?: string | undefined;
  readonly defaultModel?: string | undefined;
  readonly models?: readonly { readonly id: string; readonly label: string }[] | undefined;
}

export interface SchematicsHttpChatAdapterOptions {
  readonly baseUrl?: string | undefined;
  readonly defaultModel?: string | undefined;
  readonly models?: readonly { readonly id: string; readonly label: string }[] | undefined;
}

const DEFAULT_MODEL = SCHEMATICS_DEFAULT_OPENROUTER_MODEL;
const DEFAULT_PROXY_URL = "/v1/chat";
const MAX_TOOL_ROUNDS = 8;

export function createSchematicsChatAdapter(
  options: SchematicsHttpChatAdapterOptions = {},
): SchematicsChatAdapter {
  return createChatAdapter({
    defaultModel: options.defaultModel,
    models: options.models,
    fetchAssistantMessage: (model, messages, tools, signal) =>
      fetchProtocolAssistantMessage(options.baseUrl ?? "", model, messages, tools, signal),
  });
}

export function createOpenRouterProxyChatAdapter(
  options: OpenRouterProxyChatAdapterOptions = {},
): SchematicsChatAdapter {
  return createChatAdapter({
    defaultModel: options.defaultModel,
    models: options.models,
    fetchAssistantMessage: (model, messages, tools, signal) =>
      fetchRawProxyAssistantMessage(
        options.proxyUrl ?? DEFAULT_PROXY_URL,
        model,
        messages,
        tools,
        signal,
      ),
  });
}

function createChatAdapter(options: {
  readonly defaultModel?: string | undefined;
  readonly models?: readonly { readonly id: string; readonly label: string }[] | undefined;
  readonly fetchAssistantMessage: (
    model: string | undefined,
    messages: readonly OpenRouterMessage[],
    tools: OpenRouterChatRequest["tools"],
    signal: AbortSignal,
  ) => Promise<OpenRouterAssistantResponseMessage>;
}): SchematicsChatAdapter {
  return {
    models: options.models ?? SCHEMATICS_OPENROUTER_MODELS,
    defaultModel: options.defaultModel ?? DEFAULT_MODEL,
    send: (input) => {
      const controller = new AbortController();
      const promise = runOpenRouterTurn(options.fetchAssistantMessage, input, controller.signal);
      return {
        promise,
        cancel: () => controller.abort(),
      };
    },
  };
}

async function runOpenRouterTurn(
  fetchAssistant: (
    model: string | undefined,
    messages: readonly OpenRouterMessage[],
    tools: OpenRouterChatRequest["tools"],
    signal: AbortSignal,
  ) => Promise<OpenRouterAssistantResponseMessage>,
  input: SchematicsChatTurnInput,
  signal: AbortSignal,
): Promise<SchematicsChatResult> {
  const systemPrompt = [
    "You are helping edit an in-memory schema-backed workspace.",
    "The user edits JSON or YAML files. Effect Schema validation is authoritative.",
    "Use tools to inspect and edit files directly when the user asks for changes.",
    input.planMode
      ? "Plan mode is active: do not mutate files. Use propose_patch when suggesting edits."
      : "Direct edit mode is active: apply edits when the user asks for changes.",
    "Prefer reading relevant files before replacing content unless the reflection already contains enough context.",
    "After mutating files, call validate_workspace before giving the final answer.",
    "Keep final responses short and mention the files changed plus remaining validation errors, if any.",
  ].join("\n");

  const messages: OpenRouterMessage[] = [
    { role: "system", content: systemPrompt },
    ...historyToOpenRouterMessages(input.history),
    {
      role: "user",
      content: `${input.message}\n\nSchematics reflection:\n${JSON.stringify(input.reflection, null, 2)}`,
    },
  ];
  const toolDefinitions = openRouterSchematicsToolsForMode({ planMode: input.planMode });

  let finalContent = "";
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const message = await fetchAssistant(input.model, messages, toolDefinitions, signal);
    const assistantMessage: OpenRouterMessage = {
      role: "assistant",
      ...(message.content !== undefined ? { content: message.content } : {}),
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    };
    messages.push(assistantMessage);

    const toolCalls = message.tool_calls ?? [];
    if (!toolCalls.length) {
      finalContent = message.content ?? "No response returned.";
      break;
    }

    if (message.content) finalContent = message.content;

    for (const toolCall of toolCalls) {
      const traceBase = openRouterToolCallToTrace(toolCall);
      input.onToolCall?.({ ...traceBase, status: "pending" });

      const execution = await executeSchematicsToolCall(
        input.tools,
        toolCall.function.name,
        toolCall.function.arguments,
        { planMode: input.planMode },
      );
      const status = execution.isError ? "error" : "success";
      input.onToolCall?.({
        ...traceBase,
        args: execution.args,
        status,
        result: execution.result,
      });
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(execution.result),
      });
    }
  }

  if (!finalContent) {
    finalContent = "I ran the requested tools, but the model did not return a final response.";
  }

  input.onText?.(finalContent);

  return {
    message: {
      role: "assistant",
      content: finalContent,
      model: input.model,
    },
  };
}

function historyToOpenRouterMessages(
  history: readonly SchematicsChatMessage[],
): readonly OpenRouterMessage[] {
  return history.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

async function fetchRawProxyAssistantMessage(
  proxyUrl: string,
  model: string | undefined,
  messages: readonly OpenRouterMessage[],
  tools: OpenRouterChatRequest["tools"],
  signal: AbortSignal,
): Promise<OpenRouterAssistantResponseMessage> {
  const request: OpenRouterChatRequest = {
    model: model ?? DEFAULT_MODEL,
    messages,
    tools,
  };
  const response = await fetch(proxyUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Schematics chat failed (${response.status}): ${text}`);
  }

  const json = Schema.decodeUnknownSync(OpenRouterChatCompletionResponseSchema)(
    await response.json(),
  );
  const message = json.choices?.[0]?.message;
  if (!message) throw new Error("No response returned.");
  return message;
}

async function fetchProtocolAssistantMessage(
  baseUrl: string,
  model: string | undefined,
  messages: readonly OpenRouterMessage[],
  tools: OpenRouterChatRequest["tools"],
  signal: AbortSignal,
): Promise<OpenRouterAssistantResponseMessage> {
  const request: OpenRouterChatRequest = {
    model: model ?? DEFAULT_MODEL,
    messages,
    tools,
  };

  const effect = Effect.gen(function* () {
    const client = yield* HttpApiClient.make(SchematicsHttpApi, { baseUrl });
    const response = yield* client.chat.complete({ payload: request });
    const message = response.choices?.[0]?.message;
    if (!message) return yield* Effect.fail(new Error("No response returned."));
    return message;
  }).pipe(Effect.provide(FetchHttpClient.layer));

  return Effect.runPromise(effect, { signal });
}

function openRouterToolCallToTrace(toolCall: OpenRouterToolCall): {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
} {
  const decoded = decodeSchematicsToolArgs(toolCall.function.name, toolCall.function.arguments);
  return {
    id: toolCall.id,
    name: toolCall.function.name,
    args: decoded.args,
  };
}

export function createLocalSchematicsChatAdapter(): SchematicsChatAdapter {
  return {
    defaultModel: "local-debug",
    models: [{ id: "local-debug", label: "Local Debug" }],
    send: (input) => {
      const promise = Promise.resolve(input.tools.validateWorkspace()).then((reflection) => {
        const validationToolCall = {
          id: `tool-${Date.now()}`,
          name: "validate_workspace",
          args: {},
          status: "success" as const,
          result: reflection.validationSummary,
        };
        input.onToolCall?.(validationToolCall);

        const validation = validationToolCall.result;
        const content = validation.valid
          ? `The workspace is valid. I can see ${reflection.files.length} file(s) and ${reflection.schemas.length} schema route(s).`
          : `The workspace has ${validation.errorCount} error(s). The first issue is: ${
              reflection.diagnostics.find((diagnostic) => diagnostic.severity === "error")
                ?.message ?? "unknown"
            }`;

        input.onText?.(content);
        return {
          message: { role: "assistant" as const, content, model: "local-debug" },
        };
      });
      return {
        promise,
        cancel: () => {},
      };
    },
  };
}
