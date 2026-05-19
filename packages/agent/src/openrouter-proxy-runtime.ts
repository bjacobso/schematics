import type {
  SchemaIdeChatAdapter,
  SchemaIdeChatMessage,
  SchemaIdeChatResult,
  SchemaIdeChatTurnInput,
} from "./types";
import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import {
  OpenRouterChatCompletionResponseSchema,
  SCHEMA_IDE_DEFAULT_OPENROUTER_MODEL,
  SCHEMA_IDE_OPENROUTER_MODELS,
  type OpenRouterAssistantResponseMessage,
  type OpenRouterChatRequest,
  type OpenRouterMessage,
  type OpenRouterToolCall,
} from "@schema-ide/protocol";
import { SchemaIdeHttpApi } from "@schema-ide/protocol";
import {
  decodeSchemaIdeToolArgs,
  executeSchemaIdeToolCall,
  openRouterSchemaIdeToolsForMode,
} from "./schema-ide-toolkit";

export interface OpenRouterProxyChatAdapterOptions {
  readonly proxyUrl?: string | undefined;
  readonly defaultModel?: string | undefined;
  readonly models?: readonly { readonly id: string; readonly label: string }[] | undefined;
}

export interface SchemaIdeHttpChatAdapterOptions {
  readonly baseUrl?: string | undefined;
  readonly defaultModel?: string | undefined;
  readonly models?: readonly { readonly id: string; readonly label: string }[] | undefined;
}

const DEFAULT_MODEL = SCHEMA_IDE_DEFAULT_OPENROUTER_MODEL;
const DEFAULT_PROXY_URL = "/v1/chat";
const MAX_TOOL_ROUNDS = 8;

export function createSchemaIdeChatAdapter(
  options: SchemaIdeHttpChatAdapterOptions = {},
): SchemaIdeChatAdapter {
  return createChatAdapter({
    defaultModel: options.defaultModel,
    models: options.models,
    fetchAssistantMessage: (model, messages, tools, signal) =>
      fetchProtocolAssistantMessage(options.baseUrl ?? "", model, messages, tools, signal),
  });
}

export function createOpenRouterProxyChatAdapter(
  options: OpenRouterProxyChatAdapterOptions = {},
): SchemaIdeChatAdapter {
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
}): SchemaIdeChatAdapter {
  return {
    models: options.models ?? SCHEMA_IDE_OPENROUTER_MODELS,
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
  input: SchemaIdeChatTurnInput,
  signal: AbortSignal,
): Promise<SchemaIdeChatResult> {
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
      content: `${input.message}\n\nSchema IDE reflection:\n${JSON.stringify(input.reflection, null, 2)}`,
    },
  ];
  const toolDefinitions = openRouterSchemaIdeToolsForMode({ planMode: input.planMode });

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

      const execution = executeSchemaIdeToolCall(
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
  history: readonly SchemaIdeChatMessage[],
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
    throw new Error(`Schema IDE chat failed (${response.status}): ${text}`);
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
    const client = yield* HttpApiClient.make(SchemaIdeHttpApi, { baseUrl });
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
  const decoded = decodeSchemaIdeToolArgs(toolCall.function.name, toolCall.function.arguments);
  return {
    id: toolCall.id,
    name: toolCall.function.name,
    args: decoded.args,
  };
}

export function createLocalSchemaIdeChatAdapter(): SchemaIdeChatAdapter {
  return {
    defaultModel: "local-debug",
    models: [{ id: "local-debug", label: "Local Debug" }],
    send: (input) => {
      const validationToolCall = {
        id: `tool-${Date.now()}`,
        name: "validate_workspace",
        args: {},
        status: "success" as const,
        result: input.tools.validateWorkspace().validationSummary,
      };
      input.onToolCall?.(validationToolCall);

      const validation = validationToolCall.result;
      const content = validation.valid
        ? `The workspace is valid. I can see ${input.reflection.files.length} file(s) and ${input.reflection.schemas.length} schema route(s).`
        : `The workspace has ${validation.errorCount} error(s). The first issue is: ${
            input.reflection.diagnostics.find((diagnostic) => diagnostic.severity === "error")
              ?.message ?? "unknown"
          }`;

      input.onText?.(content);
      return {
        promise: Promise.resolve({
          message: { role: "assistant", content, model: "local-debug" },
        }),
        cancel: () => {},
      };
    },
  };
}
