import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import {
  createOpenRouterProxyChatAdapter,
  createSchemaIdeChatAdapter,
  runSchemaIdeChatEval,
  type SchemaIdeReflection,
  type SchemaIdeFileEdit,
  type SchemaIdePatchProposal,
  type SchemaIdeToolCall,
  type SchemaIdeToolRuntime,
} from "../src";
import type { SourceFile } from "@schema-ide/core";

describe("schema-ide-agent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies tool calls to an in-memory workspace", async () => {
    const files: SourceFile[] = [];
    const traces: SchemaIdeToolCall[] = [];
    const requests: unknown[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        const body =
          requests.length === 1
            ? {
                choices: [
                  {
                    message: {
                      content: null,
                      tool_calls: [
                        toolCall("1", "create_file", {
                          path: "forms/intake.json",
                          content: '{"id":"intake","title":"Intake"}\n',
                        }),
                        toolCall("2", "replace_file_content", {
                          path: "forms/intake.json",
                          search: '"Intake"',
                          replace: '"Intake Form"',
                        }),
                        toolCall("3", "validate_workspace", {}),
                      ],
                    },
                  },
                ],
              }
            : { choices: [{ message: { content: "Updated forms/intake.json." } }] };

        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const chat = createOpenRouterProxyChatAdapter({
      proxyUrl: "/proxy",
      defaultModel: "test/model",
      models: [{ id: "test/model", label: "Test Model" }],
    });
    const result = await chat.send({
      message: "Create an intake form file.",
      history: [],
      reflection: reflectionFor(files),
      tools: toolsFor(files),
      model: "test/model",
      onToolCall: (tool) => traces.push(tool),
    }).promise;

    expect(result.message.content).toBe("Updated forms/intake.json.");
    expect(files).toEqual([
      { path: "forms/intake.json", content: '{"id":"intake","title":"Intake Form"}\n' },
    ]);
    expect(traces.filter((trace) => trace.status === "success").map((trace) => trace.name)).toEqual(
      ["create_file", "replace_file_content", "validate_workspace"],
    );
  });

  it("awaits asynchronous workspace tool calls before continuing the turn", async () => {
    const files: SourceFile[] = [];
    const traces: SchemaIdeToolCall[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as { messages: readonly any[] };
        const toolMessages = request.messages.filter((message) => message.role === "tool");
        if (toolMessages.length === 0) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      toolCall("1", "create_file", {
                        path: "forms/async.json",
                        content: '{"id":"async"}\n',
                      }),
                    ],
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        expect(files).toEqual([{ path: "forms/async.json", content: '{"id":"async"}\n' }]);
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Async write observed." } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const runtime = toolsFor(files);
    runtime.createFile = async (file) => {
      await Promise.resolve();
      files.push(file);
    };

    const chat = createOpenRouterProxyChatAdapter({ defaultModel: "test/model" });
    const result = await chat.send({
      message: "Create an async file.",
      history: [],
      reflection: reflectionFor(files),
      tools: runtime,
      model: "test/model",
      onToolCall: (tool) => traces.push(tool),
    }).promise;

    expect(result.message.content).toBe("Async write observed.");
    expect(traces.findLast((trace) => trace.name === "create_file")?.status).toBe("success");
  });

  it("uses the protocol HttpApi client for standalone chat", async () => {
    let requestUrl = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requestUrl = request.url;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Handled by standalone server." } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const chat = createSchemaIdeChatAdapter({
      baseUrl: "http://schema.test",
      defaultModel: "test/model",
      models: [{ id: "test/model", label: "Test Model" }],
    });
    const result = await chat.send({
      message: "Hello",
      history: [],
      reflection: reflectionFor([]),
      tools: toolsFor([]),
      model: "test/model",
    }).promise;

    expect(result.message.content).toBe("Handled by standalone server.");
    expect(requestUrl).toBe("http://schema.test/v1/chat");
  });

  it("defaults the raw proxy adapter to the standalone chat endpoint", async () => {
    let requestUrl = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requestUrl = input instanceof Request ? input.url : String(input);
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const chat = createOpenRouterProxyChatAdapter({
      defaultModel: "test/model",
      models: [{ id: "test/model", label: "Test Model" }],
    });
    await chat.send({
      message: "Hello",
      history: [],
      reflection: reflectionFor([]),
      tools: toolsFor([]),
      model: "test/model",
    }).promise;

    expect(requestUrl).toBe("/v1/chat");
  });

  it("supports atomic apply_edits and non-mutating propose_patch tool calls", async () => {
    const files: SourceFile[] = [{ path: "forms/intake.json", content: '{"id":"intake"}\n' }];
    const traces: SchemaIdeToolCall[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as { tools: readonly any[] };
        expect(request.tools.map((tool) => tool.function.name)).toContain("apply_edits");
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    toolCall("1", "propose_patch", {
                      label: "Add title",
                      edits: [
                        {
                          path: "forms/intake.json",
                          content: '{"id":"intake","title":"Intake"}\n',
                        },
                      ],
                    }),
                    toolCall("2", "apply_edits", {
                      edits: [
                        {
                          path: "forms/intake.json",
                          content: '{"id":"intake","title":"Intake"}\n',
                        },
                      ],
                    }),
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const chat = createOpenRouterProxyChatAdapter({ defaultModel: "test/model" });
    await chat.send({
      message: "Add a title.",
      history: [],
      reflection: reflectionFor(files),
      tools: toolsFor(files),
      model: "test/model",
      onToolCall: (tool) => traces.push(tool),
    }).promise;

    expect(files).toEqual([
      { path: "forms/intake.json", content: '{"id":"intake","title":"Intake"}\n' },
    ]);
    expect(traces.findLast((trace) => trace.name === "propose_patch")?.status).toBe("success");
  });

  it("limits plan mode to read-only tools plus propose_patch", async () => {
    const files: SourceFile[] = [{ path: "forms/intake.json", content: '{"id":"intake"}\n' }];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as { tools: readonly any[] };
        const names = request.tools.map((tool) => tool.function.name);
        expect(names).toContain("propose_patch");
        expect(names).not.toContain("apply_edits");
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Plan ready." } }] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }),
    );

    const chat = createOpenRouterProxyChatAdapter({ defaultModel: "test/model" });
    await chat.send({
      message: "Plan an edit.",
      history: [],
      reflection: reflectionFor(files),
      tools: toolsFor(files),
      model: "test/model",
      planMode: true,
    }).promise;
  });

  it("runs prompt-to-artifact eval fixtures against a chat adapter", async () => {
    const files: SourceFile[] = [];
    const chat = createOpenRouterProxyChatAdapter({ defaultModel: "test/model" });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      toolCall("1", "apply_edits", {
                        edits: [{ path: "forms/intake.json", content: '{"id":"intake"}\n' }],
                      }),
                    ],
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const result = await runSchemaIdeChatEval({
      fixture: {
        name: "create-intake",
        prompt: "Create intake.",
        reflection: reflectionFor(files),
        files,
        expectedFiles: [{ path: "forms/intake.json", content: '{"id":"intake"}\n' }],
      },
      chat,
      tools: toolsFor(files),
      getFiles: () => files,
    });

    expect(result.passed).toBe(true);
  });
});

function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

function toolsFor(files: SourceFile[]): SchemaIdeToolRuntime {
  let proposalSequence = 0;
  return {
    readFile: (path) => files.find((file) => file.path === path) ?? null,
    listFiles: () => files.map((file) => file.path),
    searchFiles: (query) =>
      files.flatMap((file) =>
        file.content
          .split(/\r?\n/)
          .map((line, index) => ({ path: file.path, line: index + 1, content: line }))
          .filter((line) => line.content.includes(query)),
      ),
    writeFile: (file) => {
      const index = files.findIndex((candidate) => candidate.path === file.path);
      if (index === -1) files.push(file);
      else files[index] = file;
    },
    createFile: (file) => {
      files.push(file);
    },
    deleteFile: (path) => {
      const index = files.findIndex((file) => file.path === path);
      if (index !== -1) files.splice(index, 1);
    },
    renameFile: (fromPath, toPath) => {
      const file = files.find((candidate) => candidate.path === fromPath);
      if (file) files.splice(files.indexOf(file), 1, { ...file, path: toPath });
    },
    applyEdits: (edits) => {
      for (const edit of edits) {
        const index = files.findIndex((candidate) => candidate.path === edit.path);
        if (edit.create && index !== -1) throw new Error(`File already exists: ${edit.path}`);
        if (index === -1) files.push({ path: edit.path, content: edit.content });
        else files[index] = { path: edit.path, content: edit.content };
      }
      return {
        changedPaths: edits.map((edit) => edit.path),
        validation: reflectionFor(files).validationSummary,
      };
    },
    proposePatch: (label, edits) => {
      const nextFiles = applyEditsPreview(files, edits);
      const reflection = reflectionFor(nextFiles);
      const proposal: SchemaIdePatchProposal = {
        id: `proposal-${++proposalSequence}`,
        label,
        edits,
        files: nextFiles,
        validation: reflection.validationSummary,
        diagnostics: reflection.diagnostics,
      };
      return proposal;
    },
    validateWorkspace: () => reflectionFor(files),
    getSchema: () => reflectionFor(files).schemas,
    getJsonSchema: () => reflectionFor(files).activeJsonSchema,
    getDiagnostics: () => reflectionFor(files).diagnostics,
  };
}

function applyEditsPreview(
  files: readonly SourceFile[],
  edits: readonly SchemaIdeFileEdit[],
): readonly SourceFile[] {
  const next = [...files];
  for (const edit of edits) {
    const index = next.findIndex((candidate) => candidate.path === edit.path);
    if (index === -1) next.push({ path: edit.path, content: edit.content });
    else next[index] = { path: edit.path, content: edit.content };
  }
  return next;
}

function reflectionFor(files: readonly SourceFile[]): SchemaIdeReflection {
  return {
    mode: "workspace",
    activeFile: files[0]?.path ?? null,
    activeFormat: "json",
    files,
    schemas: [],
    activeJsonSchema: null,
    decodedValue: null,
    diagnostics: [],
    validationSummary: { valid: true, errorCount: 0, warningCount: 0, infoCount: 0 },
    routeMatches: [],
  };
}
